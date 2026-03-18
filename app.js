const express = require('express');
const redis = require('redis');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const winston = require('winston');
const { Queue } = require('bullmq');

// Mock axios in test mode
const axios = process.env.NODE_ENV === 'test' 
    ? require('axios') 
    : require('axios');
const promClient = require('prom-client');
const { verifyWebhookSignature } = require('./webhook-security');

const app = express();

// Prometheus metrics
const register = new promClient.Registry();
promClient.collectDefaultMetrics({ register });

const webhookCounter = new promClient.Counter({
    name: 'webhooks_received_total',
    help: 'Total number of webhooks received',
    labelNames: ['type', 'status'],
    registers: [register]
});

const processingDuration = new promClient.Histogram({
    name: 'webhook_processing_duration_seconds',
    help: 'Time spent processing webhooks',
    labelNames: ['type'],
    buckets: [0.1, 0.5, 1, 2, 5],
    registers: [register]
});

register.registerMetric(webhookCounter);
register.registerMetric(processingDuration);

// Logger configuration (test-friendly)
const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'error',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports: [
        new winston.transports.Console({
            format: winston.format.simple()
        })
    ]
});

// Middleware
app.use(helmet());
app.use(compression());
app.use(morgan('tiny'));

// Metrics endpoint
app.get('/metrics', async (req, res) => {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
});

// Raw body for webhook signature verification
app.use('/api/meta/webhook', express.raw({ type: '*/*', limit: '10mb' }));
app.use(express.json({ limit: '10mb' }));

// Redis client (mockable)
let redisClient;
if (process.env.NODE_ENV !== 'test') {
    redisClient = redis.createClient({
        url: process.env.REDIS_URL || 'redis://localhost:6379'
    });
    
    redisClient.on('error', (err) => logger.error('Redis Client Error', err));
    
    if (process.env.NODE_ENV !== 'test') {
        (async () => {
            try {
                await redisClient.connect();
                logger.info('✓ Redis connected');
            } catch (err) {
                logger.error('✗ Redis connection failed:', err.message);
            }
        })();
    }
}

// BullMQ Queue
let webhookQueue;
if (process.env.NODE_ENV !== 'test') {
    const connection = {
        host: process.env.REDIS_HOST || 'localhost',
        port: process.env.REDIS_PORT || 6379,
        maxRetriesPerRequest: null
    };
    webhookQueue = new Queue('webhook-queue', { connection });
}

// Rate Limiters per endpoint
const webhookLimiter = rateLimit({
    windowMs: parseInt(process.env.WEBHOOK_RATE_LIMIT_WINDOW_MS) || 60000,
    max: parseInt(process.env.WEBHOOK_RATE_LIMIT_MAX) || 1000,
    message: 'Too many webhook requests'
});

const whatsappLimiter = rateLimit({
    windowMs: parseInt(process.env.WHATSAPP_RATE_LIMIT_WINDOW_MS) || 60000,
    max: parseInt(process.env.WHATSAPP_RATE_LIMIT_MAX) || 100,
    message: 'Too many WhatsApp requests'
});

const authLimiter = rateLimit({
    windowMs: parseInt(process.env.AUTH_RATE_LIMIT_WINDOW_MS) || 60000,
    max: parseInt(process.env.AUTH_RATE_LIMIT_MAX) || 10,
    message: 'Too many authentication attempts'
});

// Health Check Endpoint
app.get('/health', async (req, res) => {
    const redisStatus = redisClient && redisClient.isOpen ? 'connected' : 'disconnected';
    const queueStatus = webhookQueue ? 'active' : 'inactive';
    
    res.status(200).json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        redis: redisStatus,
        queue: queueStatus,
        uptime: process.uptime()
    });
});

// Webhook Verification Endpoint (GET)
app.get('/api/meta/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    const verifyToken = process.env.META_WEBHOOK_VERIFY_TOKEN;

    if (mode && token) {
        if (mode === 'subscribe' && token === verifyToken) {
            logger.info('✓ Webhook verified');
            res.status(200).send(challenge);
        } else {
            logger.warn('✗ Webhook verification failed');
            res.sendStatus(403);
        }
    } else {
        res.sendStatus(400);
    }
});

// Webhook Receiving Endpoint (POST)
app.post('/api/meta/webhook', webhookLimiter, async (req, res) => {
    const startTime = Date.now();
    const rawBody = req.body; // Raw body from express.raw middleware
    
    // Parse JSON for processing
    let payload;
    try {
        payload = typeof rawBody === 'string' ? JSON.parse(rawBody) : rawBody;
    } catch (err) {
        logger.error('Failed to parse webhook payload:', err.message);
        webhookCounter.inc({ type: 'unknown', status: 'invalid' });
        return res.status(400).json({ success: false, error: 'Invalid JSON' });
    }

    const signature = req.get('X-Hub-Signature-256');
    
    // Verify webhook signature in production
    if (process.env.NODE_ENV === 'production' && process.env.META_APP_SECRET) {
        if (!verifyWebhookSignature(rawBody, signature, process.env.META_APP_SECRET)) {
            logger.warn('✗ Invalid webhook signature detected');
            webhookCounter.inc({ type: 'unknown', status: 'unauthorized' });
            return res.status(403).json({ success: false, error: 'Invalid signature' });
        }
    }

    logger.info('📨 Webhook received:', JSON.stringify(payload, null, 2));

    try {
        // Add to queue for async processing
        if (webhookQueue) {
            await webhookQueue.add('incoming_webhook', {
                payload,
                timestamp: Date.now(),
                signature
            }, {
                attempts: 3,
                backoff: {
                    type: 'exponential',
                    delay: 2000
                },
                removeOnComplete: {
                    count: 100 // Keep last 100 completed jobs
                },
                removeOnFail: {
                    count: 5000 // Keep last 5000 failed jobs for debugging
                }
            });
        }
        
        webhookCounter.inc({ type: payload.object || 'unknown', status: 'queued' });
        processingDuration.observe({ type: payload.object || 'unknown' }, (Date.now() - startTime) / 1000);
        
        res.status(200).json({ success: true, message: 'Event queued for processing' });
    } catch (error) {
        logger.error('Failed to queue webhook event:', error.message);
        webhookCounter.inc({ type: payload.object || 'unknown', status: 'failed' });
        res.status(500).json({ 
            success: false, 
            error: 'Internal Server Error',
            message: error.message 
        });
    }
});

// WhatsApp Message Sending Endpoint
app.post('/api/whatsapp/send', whatsappLimiter, async (req, res) => {
    const { userId, number, message } = req.body;

    if (!userId || !number || !message) {
        return res.status(400).json({
            success: false,
            error: 'Missing required fields: userId, number, message'
        });
    }

    try {
        const whatsappServiceUrl = process.env.WHATSAPP_SERVICE_URL || 'http://localhost:8000';
        const response = await axios.post(`${whatsappServiceUrl}/send-message`, {
            userId,
            number,
            message
        }, {
            timeout: 5000,
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        logger.info('✓ WhatsApp message sent:', response.data);
        res.status(200).json(response.data);
    } catch (error) {
        logger.error('Error sending WhatsApp message:', error.message);
        res.status(500).json({
            success: false,
            error: 'Failed to send WhatsApp message',
            details: error.message
        });
    }
});

// WhatsApp Client Initialization Endpoint
app.post('/api/whatsapp/initialize', whatsappLimiter, async (req, res) => {
    const { userId } = req.body;

    if (!userId) {
        return res.status(400).json({
            success: false,
            error: 'Missing required field: userId'
        });
    }

    try {
        const whatsappServiceUrl = process.env.WHATSAPP_SERVICE_URL || 'http://localhost:8000';
        const response = await axios.post(`${whatsappServiceUrl}/initialize`, {
            userId
        }, {
            timeout: 5000,
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        logger.info('✓ WhatsApp client initialized:', response.data);
        res.status(200).json(response.data);
    } catch (error) {
        logger.error('Error initializing WhatsApp client:', error.message);
        res.status(500).json({
            success: false,
            error: 'Failed to initialize WhatsApp client',
            details: error.message
        });
    }
});

module.exports = app;
