/**
 * CloudEvents Standard Implementation
 * 
 * Standardized event format for cross-platform interoperability
 * Spec: https://cloudevents.io/
 */

/**
 * Create CloudEvent compliant event
 */
function createCloudEvent(options) {
    const {
        type,           // Required: Event type (e.g., "com.nitro.lead.created")
        source,         // Required: Source identifier (e.g., "/meta/leadgen/12345")
        subject,        // Optional: Subject of the event
        id,             // Optional: Unique event ID (auto-generated if not provided)
        time,           // Optional: Timestamp (defaults to now)
        dataContentType,// Optional: Content type (defaults to "application/json")
        data,           // Required: Event payload
        extensions      // Optional: Extension attributes
    } = options;

    const event = {
        specversion: '1.0',
        type,
        source,
        id: id || `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        time: time || new Date().toISOString(),
        datacontenttype: dataContentType || 'application/json'
    };

    if (subject) {
        event.subject = subject;
    }

    if (data !== undefined) {
        event.data = data;
    }

    // Add extension attributes
    if (extensions) {
        Object.assign(event, extensions);
    }

    return event;
}

/**
 * Validate CloudEvent structure
 */
function validateCloudEvent(event) {
    const required = ['specversion', 'type', 'source', 'id', 'time'];
    
    for (const field of required) {
        if (!event[field]) {
            throw new Error(`Missing required CloudEvent field: ${field}`);
        }
    }

    if (event.specversion !== '1.0') {
        throw new Error(`Unsupported CloudEvent spec version: ${event.specversion}`);
    }

    return true;
}

/**
 * Event types for Meta API Gateway
 */
const EventTypes = {
    // Lead Ads Events
    LEAD_CREATED: 'com.nitro.lead.created',
    LEAD_UPDATED: 'com.nitro.lead.updated',
    LEAD_PROCESSED: 'com.nitro.lead.processed',
    LEAD_FAILED: 'com.nitro.lead.failed',
    
    // Message Events
    MESSAGE_RECEIVED: 'com.nitro.message.received',
    MESSAGE_SENT: 'com.nitro.message.sent',
    MESSAGE_DELIVERED: 'com.nitro.message.delivered',
    MESSAGE_READ: 'com.nitro.message.read',
    
    // Conversation Events
    CONVERSATION_STARTED: 'com.nitro.conversation.started',
    CONVERSATION_ASSIGNED: 'com.nitro.conversation.assigned',
    CONVERSATION_HANDOFF: 'com.nitro.conversation.handoff',
    CONVERSATION_RESOLVED: 'com.nitro.conversation.resolved',
    CONVERSATION_CLOSED: 'com.nitro.conversation.closed',
    
    // AI Events
    AI_INTENT_DETECTED: 'com.nitro.ai.intent_detected',
    AI_REPLY_SENT: 'com.nitro.ai.reply_sent',
    AI_HANDOFF_REQUESTED: 'com.nitro.ai.handoff_requested',
    
    // System Events
    WEBHOOK_RECEIVED: 'com.nitro.webhook.received',
    QUEUE_JOB_CREATED: 'com.nitro.queue.job_created',
    QUEUE_JOB_COMPLETED: 'com.nitro.queue.job_completed',
    QUEUE_JOB_FAILED: 'com.nitro.queue.job_failed'
};

/**
 * Create specific event types
 */
const EventBuilders = {
    /**
     * Lead created event
     */
    leadCreated(leadData, metadata = {}) {
        return createCloudEvent({
            type: EventTypes.LEAD_CREATED,
            source: `/meta/leadgen/${leadData.form_id || 'unknown'}`,
            subject: `lead/${leadData.lead_id}`,
            data: {
                lead_id: leadData.lead_id,
                ad_id: leadData.ad_id,
                form_id: leadData.form_id,
                customer_name: leadData.customer_name,
                email: leadData.email,
                phone_number: leadData.phone_number,
                company: leadData.company,
                platform: leadData.platform,
                received_at: leadData.received_at
            },
            extensions: {
                tenantid: metadata.tenantId || 'default',
                priority: metadata.priority || 'normal'
            }
        });
    },

    /**
     * Message received event
     */
    messageReceived(messageData, metadata = {}) {
        return createCloudEvent({
            type: EventTypes.MESSAGE_RECEIVED,
            source: `/platform/${messageData.platform}`,
            subject: `conversation/${messageData.conversation_id}`,
            data: {
                message_id: messageData.message_id,
                conversation_id: messageData.conversation_id,
                sender_id: messageData.sender_id,
                sender_type: messageData.sender_type,
                content: messageData.content,
                message_type: messageData.message_type,
                timestamp: messageData.timestamp
            },
            extensions: {
                tenantid: metadata.tenantId || 'default'
            }
        });
    },

    /**
     * Handoff initiated event
     */
    handoffInitiated(handoffData, metadata = {}) {
        return createCloudEvent({
            type: EventTypes.CONVERSATION_HANDOFF,
            source: '/ai/orchestrator',
            subject: `conversation/${handoffData.conversation_id}`,
            data: {
                conversation_id: handoffData.conversation_id,
                customer_id: handoffData.customer_id,
                intent: handoffData.intent,
                reason: handoffData.reason,
                assigned_rep: handoffData.assigned_rep,
                platform: handoffData.platform,
                priority: handoffData.priority || 'normal',
                space_id: handoffData.space_id
            },
            extensions: {
                priority: handoffData.priority || 'normal',
                sla: handoffData.sla || 'standard'
            }
        });
    },

    /**
     * AI Intent Detected event
     */
    aiIntentDetected(intentData, metadata = {}) {
        return createCloudEvent({
            type: EventTypes.AI_INTENT_DETECTED,
            source: '/ai/orchestrator',
            subject: `conversation/${intentData.conversation_id}`,
            data: {
                conversation_id: intentData.conversation_id,
                customer_id: intentData.customer_id,
                intent: intentData.intent,
                confidence: intentData.confidence,
                platform: intentData.platform,
                auto_reply_sent: !intentData.should_handoff
            }
        });
    },

    /**
     * Job completed event
     */
    jobCompleted(jobData, metadata = {}) {
        return createCloudEvent({
            type: EventTypes.QUEUE_JOB_COMPLETED,
            source: `/worker/${jobData.worker_id || 'default'}`,
            subject: `job/${jobData.job_id}`,
            data: {
                job_id: jobData.job_id,
                queue: jobData.queue,
                result: jobData.result,
                duration_ms: jobData.duration_ms,
                attempts: jobData.attempts
            }
        });
    },

    /**
     * Job failed event
     */
    jobFailed(jobData, metadata = {}) {
        return createCloudEvent({
            type: EventTypes.QUEUE_JOB_FAILED,
            source: `/worker/${jobData.worker_id || 'default'}`,
            subject: `job/${jobData.job_id}`,
            data: {
                job_id: jobData.job_id,
                queue: jobData.queue,
                error: jobData.error,
                attempts: jobData.attempts,
                will_retry: jobData.will_retry
            }
        });
    }
};

/**
 * Event Publisher - Send events to event bus
 */
class EventPublisher {
    constructor(config = {}) {
        this.eventBusUrl = config.eventBusUrl || process.env.EVENT_BUS_URL;
        this.enabled = config.enabled !== false;
    }

    /**
     * Publish event
     */
    async publish(event) {
        if (!this.enabled) {
            console.log('📤 Event (disabled):', JSON.stringify(event, null, 2));
            return { success: true, published: false };
        }

        try {
            // Validate event
            validateCloudEvent(event);

            // Publish to event bus (in production: Kafka, RabbitMQ, AWS EventBridge)
            const response = await fetch(this.eventBusUrl || 'http://localhost:8080/events', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/cloudevents+json',
                    'Authorization': `Bearer ${process.env.EVENT_BUS_TOKEN || ''}`
                },
                body: JSON.stringify(event),
                timeout: 5000
            });

            if (!response.ok) {
                throw new Error(`Event bus returned ${response.status}`);
            }

            console.log('📤 Event published:', event.type);
            
            return {
                success: true,
                published: true,
                eventId: event.id
            };

        } catch (error) {
            console.error('Failed to publish event:', error.message);
            
            // Fallback: Log event for later replay
            this.logEventForReplay(event);
            
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Log event for replay (fallback)
     */
    async logEventForReplay(event) {
        // In production: Insert into events table for later replay
        console.log('💾 Event logged for replay:', event.id);
    }
}

module.exports = {
    createCloudEvent,
    validateCloudEvent,
    EventTypes,
    EventBuilders,
    EventPublisher
};
