const { Queue, Worker, Job } = require('bullmq');
const axios = require('axios');
const winston = require('winston');
const AIOrchestrator = require('./ai-orchestrator');
const GoogleChatHandoff = require('./google-chat-handoff');
const { EventBuilders, EventPublisher } = require('./cloudevents');

const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports: [
        new winston.transports.Console({
            format: winston.format.simple()
        }),
        new winston.transports.File({ filename: 'logs/worker.log' })
    ]
});

// Initialize services
const aiOrchestrator = new AIOrchestrator();
const googleChatHandoff = new GoogleChatHandoff();
const eventPublisher = new EventPublisher();

// Redis connection
const connection = {
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379,
    maxRetriesPerRequest: null // Required for BullMQ
};

// Create queues
const webhookQueue = new Queue('webhook-queue', { connection });
const leadQueue = new Queue('lead-processing-queue', { connection });
const messageQueue = new Queue('message-processing-queue', { connection });
const googleChatQueue = new Queue('google-chat-queue', { connection });

/**
 * Process Lead Ad with idempotency
 */
async function processLeadAd(job) {
    const { leadgenPayload, timestamp } = job.data;
    const { ad_id, form_id, leadgen_id, field_data } = leadgenPayload;

    logger.info(`🎯 Processing lead: ${leadgen_id} (Job ID: ${job.id})`);

    try {
        // Check for duplicate (idempotency)
        const isDuplicate = await checkDuplicateLead(leadgen_id);
        if (isDuplicate) {
            logger.warn(`⚠️ Duplicate lead detected: ${leadgen_id}`);
            return { success: false, reason: 'duplicate' };
        }

        // Extract lead data
        const leadData = {
            lead_id: leadgen_id,
            ad_id,
            form_id,
            platform: 'facebook',
            source: 'facebook_lead_ads',
            raw_data: field_data,
            received_at: timestamp
        };

        // Parse fields
        for (const field of field_data || []) {
            if (field.name === 'full_name') {
                leadData.customer_name = field.values?.[0];
            } else if (field.name === 'email') {
                leadData.email = field.values?.[0];
            } else if (field.name === 'phone_number') {
                leadData.phone_number = field.values?.[0];
            } else if (field.name === 'company') {
                leadData.company = field.values?.[0];
            }
        }

        logger.info(`👤 Extracted lead data:`, leadData);

        // Forward to Nitro ERP
        const erpUrl = process.env.NITRO_ERP_URL || 'http://localhost:5000';
        const response = await axios.post(`${erpUrl}/api/crm/leads`, leadData, {
            timeout: 10000,
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key': process.env.NITRO_ERP_API_KEY || ''
            },
            validateStatus: function (status) {
                return status < 500; // Don't throw on 4xx
            }
        });

        if (response.status >= 400) {
            throw new Error(`ERP returned status ${response.status}: ${response.data?.message}`);
        }

        // Mark as processed (idempotency)
        await markLeadAsProcessed(leadgen_id);

        logger.info(`✅ Lead forwarded to ERP: ${leadgen_id}`);

        return { 
            success: true, 
            erp_response: response.data,
            lead_id: leadgen_id
        };

    } catch (error) {
        logger.error(`❌ Failed to process lead ${leadgen_id}:`, error.message);
        
        // Log to dead letter if max attempts reached
        if (job.attemptsMade >= job.opts.attempts) {
            await logToDeadLetter('lead', leadgen_id, error.message);
        }
        
        throw error; // Let BullMQ handle retry
    }
}

/**
 * Process Message with AI + Google Chat Handoff
 */
async function processMessage(job) {
    const { messagePayload, timestamp } = job.data;
    
    logger.info(`💬 Processing message (Job ID: ${job.id})`);

    try {
        // Step 1: Extract message content
        const { sender_id, text, platform, conversation_id } = messagePayload;
        
        // Step 2: AI Intent Detection
        const aiResult = await aiOrchestrator.processMessage(text, {
            customerId: sender_id,
            platform,
            conversationId: conversation_id
        });
        
        logger.info(`🎯 AI Intent: ${aiResult.intent} (confidence: ${aiResult.confidence})`);
        
        // Step 3: Publish AI event
        const aiEvent = EventBuilders.aiIntentDetected({
            conversation_id,
            customer_id: sender_id,
            intent: aiResult.intent,
            confidence: aiResult.confidence,
            platform
        });
        await eventPublisher.publish(aiEvent);
        
        // Step 4: Handle based on intent
        if (aiResult.shouldHandoff) {
            logger.info(`🔄 Handoff required: ${aiResult.handoffReason}`);
            
            // Queue for Google Chat handoff
            await googleChatQueue.add('handoff_to_human', {
                customerId: sender_id,
                customerName: messagePayload.customer_name || 'Unknown',
                customerEmail: messagePayload.customer_email || '',
                conversationHistory: [{ sender: 'customer', text }],
                intent: aiResult.intent,
                handoffReason: aiResult.handoffReason,
                priority: aiResult.priority || 'normal',
                platform
            }, {
                attempts: 3,
                backoff: { type: 'exponential', delay: 2000 }
            });
            
            // Send auto-reply to customer
            await sendAutoReply(platform, sender_id, aiResult.reply);
            
            return {
                success: true,
                action: 'handoff_initiated',
                intent: aiResult.intent,
                reply_sent: true
            };
        } else {
            // AI can handle - send auto-reply
            logger.info(`🤖 Sending AI auto-reply`);
            await sendAutoReply(platform, sender_id, aiResult.reply);
            
            return {
                success: true,
                action: 'auto_reply_sent',
                intent: aiResult.intent,
                reply: aiResult.reply
            };
        }

    } catch (error) {
        logger.error(`❌ Failed to process message:`, error.message);
        
        if (job.attemptsMade >= job.opts.attempts) {
            await logToDeadLetter('message', messagePayload.message_id, error.message);
        }
        
        throw error;
    }
}

/**
 * Send Auto Reply via platform
 */
async function sendAutoReply(platform, recipientId, message) {
    try {
        if (platform === 'whatsapp') {
            const whatsappServiceUrl = process.env.WHATSAPP_SERVICE_URL || 'http://localhost:8000';
            await axios.post(`${whatsappServiceUrl}/send-message`, {
                userId: recipientId,
                number: recipientId,
                message
            }, {
                timeout: 5000,
                headers: { 'Content-Type': 'application/json' }
            });
            
            logger.info(`✓ WhatsApp reply sent to ${recipientId}`);
            
        } else if (platform === 'facebook' || platform === 'instagram') {
            // Use Meta Graph API to send reply
            const accessToken = process.env.META_ACCESS_TOKEN;
            const graphApiUrl = `https://graph.facebook.com/v18.0/${recipientId}/messages`;
            
            await axios.post(graphApiUrl, {
                recipient: { id: recipientId },
                message: { text: message },
                messaging_type: 'RESPONSE'
            }, {
                params: { access_token: accessToken },
                timeout: 5000
            });
            
            logger.info(`✓ ${platform} reply sent to ${recipientId}`);
        }
        
    } catch (error) {
        logger.error(`Failed to send auto-reply:`, error.message);
        // Don't throw - continue processing
    }
}

/**
 * Process Google Chat Handoff
 */
async function processGoogleChatHandoff(job) {
    const {
        customerId,
        customerName,
        customerEmail,
        conversationHistory,
        intent,
        handoffReason,
        priority,
        platform
    } = job.data;

    logger.info(`🔄 Processing Google Chat handoff for ${customerName}`);

    try {
        // Initiate handoff to Google Chat
        const handoffResult = await googleChatHandoff.initiateHandoff({
            customerId,
            customerName,
            customerEmail,
            conversationHistory,
            intent,
            handoffReason,
            priority
        });

        if (handoffResult.success) {
            logger.info(`✅ Handoff successful: Space ${handoffResult.spaceId}`);
            
            // Publish handoff event
            const handoffEvent = EventBuilders.handoffInitiated({
                conversation_id: customerId,
                customer_id: customerId,
                intent,
                reason: handoffReason,
                assigned_rep: handoffResult.assignedRep,
                platform,
                priority,
                space_id: handoffResult.spaceId
            });
            await eventPublisher.publish(handoffEvent);
            
            return {
                success: true,
                spaceId: handoffResult.spaceId,
                assignedRep: handoffResult.assignedRep
            };
        } else {
            throw new Error(handoffResult.error || 'Handoff failed');
        }

    } catch (error) {
        logger.error(`❌ Google Chat handoff failed:`, error.message);
        
        if (job.attemptsMade >= job.opts.attempts) {
            await logToDeadLetter('google_chat_handoff', customerId, error.message);
        }
        
        throw error;
    }
}

/**
 * Idempotency check - PostgreSQL
 */
async function checkDuplicateLead(leadId) {
    // This would query PostgreSQL in production
    // For now, using Redis as cache
    const redis = require('redis');
    const client = redis.createClient({ url: `redis://${process.env.REDIS_HOST || 'localhost'}:${process.env.REDIS_PORT || 6379}` });
    
    await client.connect();
    const exists = await client.get(`lead:${leadId}`);
    await client.quit();
    
    return exists !== null;
}

/**
 * Mark lead as processed
 */
async function markLeadAsProcessed(leadId) {
    const redis = require('redis');
    const client = redis.createClient({ url: `redis://${process.env.REDIS_HOST || 'localhost'}:${process.env.REDIS_PORT || 6379}` });
    
    await client.connect();
    await client.setEx(`lead:${leadId}`, 86400 * 30, 'processed'); // 30 days
    await client.quit();
}

/**
 * Log to dead letter queue
 */
async function logToDeadLetter(type, id, error) {
    logger.error(`💀 Dead Letter: ${type} - ${id} - ${error}`);
    // In production, insert into dead_letter table
}

// Create workers
const leadWorker = new Worker('lead-processing-queue', processLeadAd, {
    connection,
    concurrency: 5, // Process 5 leads in parallel
    limiter: {
        max: 10,
        duration: 1000 // 10 leads per second
    }
});

const messageWorker = new Worker('message-processing-queue', processMessage, {
    connection,
    concurrency: 10
});

const googleChatWorker = new Worker('google-chat-queue', processGoogleChatHandoff, {
    connection,
    concurrency: 3, // 3 handoffs in parallel
    limiter: {
        max: 5,
        duration: 1000 // 5 handoffs per second
    }
});

// Worker event handlers
leadWorker.on('completed', (job, result) => {
    logger.info(`✅ Lead Job ${job.id} completed:`, result);
});

leadWorker.on('failed', (job, err) => {
    logger.error(`❌ Lead Job ${job.id} failed:`, err.message);
});

leadWorker.on('error', (err) => {
    logger.error(`💥 Lead Worker error:`, err.message);
});

messageWorker.on('completed', (job, result) => {
    logger.info(`✅ Message Job ${job.id} completed:`, result);
});

messageWorker.on('failed', (job, err) => {
    logger.error(`❌ Message Job ${job.id} failed:`, err.message);
});

googleChatWorker.on('completed', (job, result) => {
    logger.info(`✅ Google Chat Handoff Job ${job.id} completed:`, result);
});

googleChatWorker.on('failed', (job, err) => {
    logger.error(`❌ Google Chat Handoff Job ${job.id} failed:`, err.message);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
    logger.info('SIGTERM received, shutting down workers...');
    
    await leadWorker.close();
    await messageWorker.close();
    await googleChatWorker.close();
    await webhookQueue.close();
    await leadQueue.close();
    await messageQueue.close();
    await googleChatQueue.close();
    
    process.exit(0);
});

logger.info('🚀 Workers started successfully');
logger.info('  - Lead Worker: Active');
logger.info('  - Message Worker: Active (with AI Orchestrator)');
logger.info('  - Google Chat Handoff Worker: Active');

module.exports = {
    webhookQueue,
    leadQueue,
    messageQueue,
    leadWorker,
    messageWorker
};
