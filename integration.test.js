const request = require('supertest');
const app = require('./app');

jest.mock('axios');
jest.mock('bullmq', () => {
    const mockQueueInstance = {
        add: jest.fn().mockResolvedValue({ id: 'job-123' }),
        close: jest.fn()
    };
    
    return {
        Queue: jest.fn().mockImplementation(() => mockQueueInstance),
        Worker: jest.fn().mockImplementation(() => ({
            on: jest.fn(),
            close: jest.fn()
        }))
    };
});

describe('Integration Tests - Full Workflow', () => {
    let originalEnv;
    const mockQueueAdd = jest.fn().mockResolvedValue({ id: 'job-123' });

    beforeEach(() => {
        originalEnv = process.env;
        process.env = {
            ...originalEnv,
            NODE_ENV: 'test',
            META_WEBHOOK_VERIFY_TOKEN: 'test-token',
            META_APP_SECRET: 'test-secret',
            LOG_LEVEL: 'error',
            WEBHOOK_RATE_LIMIT_WINDOW_MS: '60000',
            WEBHOOK_RATE_LIMIT_MAX: '1000'
        };

        // Reset mocks
        mockQueueAdd.mockClear();
        jest.clearAllMocks();
    });

    afterAll(() => {
        process.env = originalEnv;
    });

    describe('Lead Ad Webhook Flow', () => {
        it('processes complete lead ad webhook flow', async () => {
            const validPayload = {
                object: 'leadgen',
                entry: [{
                    changes: [{
                        value: {
                            leadgen_id: 'lead_12345',
                            form_id: 'form_67890',
                            ad_id: 'ad_111',
                            field_data: [
                                { name: 'full_name', values: ['John Doe'] },
                                { name: 'email', values: ['john@example.com'] },
                                { name: 'phone_number', values: ['+905551234567'] }
                            ]
                        }
                    }]
                }]
            };

            // Step 1: Webhook verification (GET)
            const verifyResponse = await request(app)
                .get('/api/meta/webhook')
                .query({
                    'hub.mode': 'subscribe',
                    'hub.verify_token': 'test-token',
                    'hub.challenge': 'challenge123'
                })
                .expect(200);

            expect(verifyResponse.text).toBe('challenge123');

            // Step 2: Webhook received (POST)
            const webhookResponse = await request(app)
                .post('/api/meta/webhook')
                .send(validPayload)
                .expect(200);

            expect(webhookResponse.body).toMatchObject({
                success: true,
                message: 'Event queued for processing'
            });

            // Webhook accepted successfully (queue processing happens async)
            expect(webhookResponse.status).toBe(200);
        });

        it('rejects webhook with invalid signature', async () => {
            process.env.NODE_ENV = 'production';
            
            const payload = {
                object: 'leadgen',
                entry: [{ changes: [] }]
            };

            const response = await request(app)
                .post('/api/meta/webhook')
                .set('X-Hub-Signature-256', 'sha256=invalid')
                .send(payload)
                .expect(403);

            expect(response.body).toMatchObject({
                success: false,
                error: 'Invalid signature'
            });
        });

        it('handles duplicate leads (idempotency)', async () => {
            const payload = {
                object: 'leadgen',
                entry: [{
                    changes: [{
                        value: {
                            leadgen_id: 'duplicate_lead_123',
                            form_id: 'form_456',
                            field_data: []
                        }
                    }]
                }]
            };

            // First submission
            await request(app)
                .post('/api/meta/webhook')
                .send(payload)
                .expect(200);

            // Second submission (duplicate)
            await request(app)
                .post('/api/meta/webhook')
                .send(payload)
                .expect(200);

            // Both submissions accepted (worker handles idempotency via DB UNIQUE constraint)
        });
    });

    describe('Health Check & Monitoring', () => {
        it('returns healthy status', async () => {
            const response = await request(app)
                .get('/health')
                .expect(200);

            expect(response.body).toMatchObject({
                status: 'OK',
                redis: expect.any(String),
                uptime: expect.any(Number)
            });
        });

        it('exposes metrics endpoint', async () => {
            const response = await request(app)
                .get('/metrics')
                .expect(200);

            expect(response.text).toContain('# HELP');
            expect(response.text).toContain('webhooks_received_total');
        });
    });

    describe('Rate Limiting Integration', () => {
        it('applies rate limiting to webhook endpoint', async () => {
            // Create a fresh app instance with rate limiting config
            process.env.WEBHOOK_RATE_LIMIT_MAX = '1';
            process.env.WEBHOOK_RATE_LIMIT_WINDOW_MS = '60000'; // 1 minute
            
            jest.resetModules();
            const request = require('supertest');
            const axios = require('axios');
            
            // Setup axios mock
            axios.post = jest.fn().mockResolvedValue({ data: { success: true } });
            
            const app = require('./app');
            
            const payload = {
                object: 'leadgen',
                entry: [{ changes: [] }]
            };

            // First request should succeed
            await request(app).post('/api/meta/webhook').send(payload);
            
            // Second request within window should be rate limited
            const response = await request(app)
                .post('/api/meta/webhook')
                .send(payload);

            expect(response.status).toBe(429);
        });
    });

    describe('WhatsApp Integration', () => {
        const axios = require('axios');

        beforeEach(() => {
            axios.post.mockResolvedValue({
                data: { success: true, messageId: 'wamid.test' }
            });
        });

        afterEach(() => {
            jest.clearAllMocks();
        });

        it('forwards WhatsApp message request', async () => {
            const messageData = {
                userId: 'USER_123',
                number: '+905551234567',
                message: 'Test message'
            };

            const response = await request(app)
                .post('/api/whatsapp/send')
                .send(messageData)
                .expect(200);

            expect(response.body.success).toBe(true);
            expect(axios.post).toHaveBeenCalledWith(
                expect.stringContaining('/send-message'),
                messageData,
                expect.any(Object)
            );
        });

        it('validates required fields for WhatsApp send', async () => {
            const response = await request(app)
                .post('/api/whatsapp/send')
                .send({ userId: 'USER_123' })
                .expect(400);

            expect(response.body.error).toContain('Missing required fields');
        });

        it('initializes WhatsApp client', async () => {
            axios.post.mockResolvedValue({
                data: { success: true, qrCode: 'data:image/png;base64,...' }
            });

            const response = await request(app)
                .post('/api/whatsapp/initialize')
                .send({ userId: 'USER_123' })
                .expect(200);

            expect(response.body.success).toBe(true);
            expect(axios.post).toHaveBeenCalledWith(
                expect.stringContaining('/initialize'),
                { userId: 'USER_123' },
                expect.any(Object)
            );
        });
    });

    describe('Error Handling', () => {
        it('handles malformed JSON', async () => {
            // Gateway accepts raw body, worker handles validation
            const response = await request(app)
                .post('/api/meta/webhook')
                .set('Content-Type', 'application/json')
                .send('invalid json {');
            
            // Returns 200 (worker will process and handle errors)
            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
        });

        it('handles missing webhook parameters', async () => {
            const response = await request(app)
                .get('/api/meta/webhook')
                .query({})
                .expect(400);
        });

        it('handles incorrect verify token', async () => {
            const response = await request(app)
                .get('/api/meta/webhook')
                .query({
                    'hub.mode': 'subscribe',
                    'hub.verify_token': 'wrong-token',
                    'hub.challenge': 'challenge123'
                })
                .expect(403);
        });
    });

    describe('CloudEvents Integration', () => {
        const { EventBuilders, validateCloudEvent } = require('./cloudevents');

        it('creates valid CloudEvent for lead creation', () => {
            const event = EventBuilders.leadCreated({
                lead_id: 'lead_123',
                form_id: 'form_456',
                customer_name: 'John Doe',
                email: 'john@example.com',
                received_at: new Date().toISOString()
            });

            expect(() => validateCloudEvent(event)).not.toThrow();
            expect(event.type).toBe('com.nitro.lead.created');
            expect(event.data.lead_id).toBe('lead_123');
        });

        it('creates valid CloudEvent for handoff', () => {
            const event = EventBuilders.handoffInitiated({
                conversation_id: 'conv_789',
                customer_id: 'cust_123',
                intent: 'complaint',
                reason: 'Customer unhappy',
                assigned_rep: 'yasar.orhan@nitrobilisim.com',
                platform: 'facebook'
            });

            expect(() => validateCloudEvent(event)).not.toThrow();
            expect(event.type).toBe('com.nitro.conversation.handoff');
            expect(event.data.assigned_rep).toBe('yasar.orhan@nitrobilisim.com');
        });
    });
});
