const request = require('supertest');
const crypto = require('crypto');
const { verifyWebhookSignature } = require('./webhook-security');

// Mock axios before importing app - use factory pattern
jest.mock('axios', () => ({
    post: jest.fn().mockResolvedValue({ data: { success: true } })
}));
const axios = require('axios');

// Store original environment
const ORIGINAL_ENV = process.env;

let app;

// Environment isolation for each test
beforeEach(() => {
    jest.resetModules();
    process.env = { 
        ...ORIGINAL_ENV,
        META_WEBHOOK_VERIFY_TOKEN: 'test-token',
        NODE_ENV: 'test',
        LOG_LEVEL: 'error',
        RATE_LIMIT_WINDOW_MS: '60000',
        RATE_LIMIT_MAX_REQUESTS: '100',
        WEBHOOK_RATE_LIMIT_WINDOW_MS: '60000',
        WEBHOOK_RATE_LIMIT_MAX: '1000',
        WHATSAPP_SERVICE_URL: 'http://mocked-whatsapp:8000'
    };
    
    // Clear and reset axios mock
    axios.post.mockClear();
    axios.post.mockResolvedValue({ data: { success: true } });
    
    // Clear all mocks
    jest.clearAllMocks();
    
    // Import fresh app instance
    app = require('./app');
});

afterAll(() => {
    process.env = ORIGINAL_ENV;
});

// ============================================================================
// UNIT TESTS - Signature Verification
// ============================================================================

describe('verifyWebhookSignature (Unit Tests)', () => {
    it('returns true for valid signature', () => {
        const body = Buffer.from(JSON.stringify({ test: 'data' }));
        const secret = 'test-secret';

        const expectedHash = crypto
            .createHmac('sha256', secret)
            .update(body)
            .digest('hex');

        const signature = `sha256=${expectedHash}`;

        expect(verifyWebhookSignature(body, signature, secret)).toBe(true);
    });

    it('returns false for invalid signature', () => {
        const body = Buffer.from(JSON.stringify({ test: 'data' }));
        const secret = 'test-secret';

        expect(verifyWebhookSignature(body, 'sha256=invalid', secret)).toBe(false);
    });

    it('returns false when signature is null', () => {
        const body = Buffer.from(JSON.stringify({ test: 'data' }));
        const secret = 'test-secret';

        expect(verifyWebhookSignature(body, null, secret)).toBe(false);
    });

    it('returns false when secret is missing', () => {
        const body = Buffer.from(JSON.stringify({ test: 'data' }));
        const signature = 'sha256=abc123';

        expect(verifyWebhookSignature(body, signature, null)).toBe(false);
    });

    it('returns false for wrong algorithm', () => {
        const body = Buffer.from(JSON.stringify({ test: 'data' }));
        const secret = 'test-secret';
        const signature = `md5=invalid`;

        expect(verifyWebhookSignature(body, signature, secret)).toBe(false);
    });
});

// ============================================================================
// INTEGRATION TESTS - Health Check
// ============================================================================

describe('Health Check Endpoint', () => {
    it('returns 200 and health status', async () => {
        const response = await request(app)
            .get('/health')
            .expect(200);

        expect(response.body).toMatchObject({
            status: 'OK'
        });
        expect(response.body).toHaveProperty('timestamp');
        expect(response.body).toHaveProperty('redis');
        expect(['connected', 'disconnected']).toContain(response.body.redis);
    });
});

// ============================================================================
// INTEGRATION TESTS - Webhook Verification (GET)
// ============================================================================

describe('Webhook Verification Endpoint (GET)', () => {
    it('verifies webhook with correct token', async () => {
        const challenge = 'challenge-123';

        const response = await request(app)
            .get('/api/meta/webhook')
            .query({
                'hub.mode': 'subscribe',
                'hub.verify_token': 'test-token',
                'hub.challenge': challenge
            })
            .expect(200);

        expect(response.text).toBe(challenge);
    });

    it('rejects webhook with wrong token', async () => {
        await request(app)
            .get('/api/meta/webhook')
            .query({
                'hub.mode': 'subscribe',
                'hub.verify_token': 'wrong-token',
                'hub.challenge': 'challenge'
            })
            .expect(403);
    });

    it('rejects missing mode parameter', async () => {
        await request(app)
            .get('/api/meta/webhook')
            .query({
                'hub.verify_token': 'token',
                'hub.challenge': 'challenge'
            })
            .expect(400);
    });
});

// ============================================================================
// INTEGRATION TESTS - Webhook Receiving (POST)
// ============================================================================

describe('Webhook Receiving Endpoint (POST)', () => {
    const validPayload = {
        object: 'page',
        entry: [{
            id: '123456789',
            time: Date.now(),
            changes: [{
                field: 'leadgen',
                value: {
                    ad_id: 'AD_123',
                    form_id: 'FORM_123',
                    leadgen_id: 'LEAD_123',
                    field_data: [
                        { name: 'full_name', values: ['Test User'] },
                        { name: 'email', values: ['test@example.com'] }
                    ]
                }
            }]
        }]
    };

    it('accepts webhook without signature in test mode', async () => {
        // Verify test mode accepts webhooks without signature
        const response = await request(app)
            .post('/api/meta/webhook')
            .send(validPayload);

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
    });

    it('rejects webhook with invalid signature in production', async () => {
        process.env.NODE_ENV = 'production';
        process.env.META_APP_SECRET = 'test-secret';
        app = require('./app');

        const response = await request(app)
            .post('/api/meta/webhook')
            .set('X-Hub-Signature-256', 'sha256=invalid')
            .send(validPayload)
            .expect(403);

        expect(response.body).toMatchObject({
            success: false,
            error: 'Invalid signature'
        });
    });

    it('accepts webhook with valid signature in production', async () => {
        process.env.NODE_ENV = 'production';
        process.env.META_APP_SECRET = 'test-secret';
        app = require('./app');

        const body = JSON.stringify(validPayload);
        const hash = crypto
            .createHmac('sha256', 'test-secret')
            .update(body)
            .digest('hex');
        const signature = `sha256=${hash}`;

        const response = await request(app)
            .post('/api/meta/webhook')
            .set('X-Hub-Signature-256', signature)
            .set('Content-Type', 'application/json')
            .send(validPayload)
            .expect(200);

        expect(response.body).toMatchObject({
            success: true
        });
    });

    it('applies rate limiting', async () => {
        // Set low limit for testing with short window
        process.env = {
            ...ORIGINAL_ENV,
            META_WEBHOOK_VERIFY_TOKEN: 'test-token',
            NODE_ENV: 'test',
            LOG_LEVEL: 'error',
            WEBHOOK_RATE_LIMIT_WINDOW_MS: '1000', // 1 second
            WEBHOOK_RATE_LIMIT_MAX: '3'
        };
        
        axios.post.mockClear();
        axios.post.mockResolvedValue({ data: { success: true } });
        
        jest.resetModules();
        app = require('./app');

        const validPayload = {
            object: 'leadgen',
            entry: [{ changes: [{ value: { leadgen_id: 'test_123' } }] }]
        };

        // First 3 requests should succeed
        await request(app).post('/api/meta/webhook').send(validPayload);
        await request(app).post('/api/meta/webhook').send(validPayload);
        await request(app).post('/api/meta/webhook').send(validPayload);
        
        // 4th should be rate limited (rapid fire within 1s window)
        const response = await request(app)
            .post('/api/meta/webhook')
            .send(validPayload);

        expect(response.status).toBe(429);
    });
});

// ============================================================================
// INTEGRATION TESTS - WhatsApp Endpoints
// ============================================================================

describe('WhatsApp Send Endpoint', () => {
    it('rejects request with missing fields', async () => {
        const response = await request(app)
            .post('/api/whatsapp/send')
            .send({ userId: 'USER_123' })
            .expect(400);

        expect(response.body).toMatchObject({
            success: false,
            error: expect.stringContaining('Missing required fields')
        });
    });

    it('accepts valid send request (mocked)', async () => {
        // Mock axios for this test - setup BEFORE request
        const mockAxiosPost = require('axios').post;
        mockAxiosPost.mockResolvedValueOnce({
            data: { success: true, messageId: 'wamid.xxx', status: 'sent' }
        });

        const response = await request(app)
            .post('/api/whatsapp/send')
            .send({
                userId: 'USER_123',
                number: '+905551234567',
                message: 'Test message'
            });

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.messageId).toBeDefined();
    });

    it('handles external service errors gracefully', async () => {
        // Mock axios rejection for this test
        const mockAxiosPost = require('axios').post;
        mockAxiosPost.mockRejectedValueOnce(new Error('Service unavailable'));

        const response = await request(app)
            .post('/api/whatsapp/send')
            .send({
                userId: 'USER_123',
                number: '+905551234567',
                message: 'Test message'
            });

        expect(response.status).toBe(500);
        expect(response.body.success).toBe(false);
    });
});

describe('WhatsApp Initialize Endpoint', () => {
    it('rejects request without userId', async () => {
        const response = await request(app)
            .post('/api/whatsapp/initialize')
            .send({})
            .expect(400);

        expect(response.body).toMatchObject({
            success: false,
            error: 'Missing required field: userId'
        });
    });

    it('accepts initialize request with userId (mocked)', async () => {
        // Mock axios for this test
        const mockAxiosPost = require('axios').post;
        mockAxiosPost.mockResolvedValueOnce({
            data: { success: true, qrCode: 'data:image/png;base64,...' }
        });

        const response = await request(app)
            .post('/api/whatsapp/initialize')
            .send({ userId: 'USER_123' });

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
    });
});

// ============================================================================
// ERROR HANDLING TESTS
// ============================================================================

describe('Error Handling', () => {
    it('returns 404 for unknown routes', async () => {
        await request(app)
            .get('/nonexistent-route')
            .expect(404);
    });

    it('returns proper error format', async () => {
        const response = await request(app)
            .post('/api/whatsapp/send')
            .send({ incomplete: 'data' });

        expect(response.body).toMatchObject({
            success: false,
            error: expect.any(String)
        });
    });
});

// ============================================================================
// INPUT VALIDATION TESTS
// ============================================================================

describe('Input Validation', () => {
    it('rejects oversized payloads', async () => {
        const largePayload = {
            data: 'x'.repeat(11 * 1024 * 1024) // 11MB
        };

        await request(app)
            .post('/api/meta/webhook')
            .send(largePayload)
            .expect(413); // Payload Too Large
    });

    it('handles malformed JSON gracefully', async () => {
        // Note: With express.raw middleware, the webhook endpoint receives raw body
        // The JSON parsing happens in the worker, not in the gateway
        // So malformed JSON will still return 200 but worker will handle it
        const response = await request(app)
            .post('/api/meta/webhook')
            .set('Content-Type', 'application/json')
            .send('not valid json');
        
        // Gateway accepts raw body (200), worker will handle validation
        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
    });
});

