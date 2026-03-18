const axios = require('axios');
const winston = require('winston');

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
        new winston.transports.File({ filename: 'logs/google-chat.log' })
    ]
});

/**
 * Google Chat Handoff Integration
 * 
 * When AI decides human handoff is needed:
 * 1. Create space in Google Chat
 * 2. Add customer + sales rep
 * 3. Post context message
 * 4. Track conversation status
 */
class GoogleChatHandoff {
    constructor(config = {}) {
        this.googleChatWebhookUrl = config.webhookUrl || process.env.GOOGLE_CHAT_WEBHOOK_URL;
        this.serviceAccountKey = config.serviceAccountKey || process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
        
        // Sales team mapping
        this.salesTeam = config.salesTeam || JSON.parse(process.env.SALES_TEAM_MEMBERS || '{}');
        
        // Conversation tracking
        this.activeConversations = new Map();
    }

    /**
     * Initiate handoff to Google Chat
     * @param {Object} params - Handoff parameters
     * @returns {Object} - { success, spaceId, threadId }
     */
    async initiateHandoff(params) {
        const {
            customerId,
            customerName,
            customerEmail,
            conversationHistory,
            intent,
            handoffReason,
            priority = 'normal' // normal, high, urgent
        } = params;

        try {
            logger.info(`🔄 Initiating Google Chat handoff for ${customerName}`);

            // Step 1: Assign sales rep based on intent/priority
            const assignedRep = await this.assignSalesRep(intent, priority);

            // Step 2: Create Google Chat space
            const spaceInfo = await this.createChatSpace(customerName, assignedRep);

            // Step 3: Post context message
            await this.postContextMessage(spaceInfo.spaceId, {
                customerName,
                customerEmail,
                intent,
                handoffReason,
                conversationHistory,
                assignedRep
            });

            // Step 4: Track conversation
            this.activeConversations.set(customerId, {
                spaceId: spaceInfo.spaceId,
                threadId: spaceInfo.threadId,
                assignedRep,
                status: 'active',
                createdAt: new Date().toISOString()
            });

            // Step 5: Notify sales rep via email/SMS
            await this.notifySalesRep(assignedRep, {
                customerName,
                customerEmail,
                spaceId: spaceInfo.spaceId
            });

            logger.info(`✅ Handoff successful: ${spaceInfo.spaceId}`);

            return {
                success: true,
                spaceId: spaceInfo.spaceId,
                threadId: spaceInfo.threadId,
                assignedRep
            };

        } catch (error) {
            logger.error('Google Chat handoff failed:', error.message);
            
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Assign sales rep based on intent and availability
     */
    async assignSalesRep(intent, priority) {
        // Simple round-robin or skill-based assignment
        // In production: Query CRM for rep availability
        
        const availableReps = Object.keys(this.salesTeam);
        
        if (availableReps.length === 0) {
            // Fallback to default rep
            return 'default-rep@nitrobilisim.com';
        }

        // Priority-based assignment
        if (priority === 'urgent') {
            // Assign senior rep
            return this.salesTeam.senior || availableReps[0];
        }

        // Random assignment for normal priority
        const randomIndex = Math.floor(Math.random() * availableReps.length);
        return availableReps[randomIndex];
    }

    /**
     * Create Google Chat space
     */
    async createChatSpace(customerName, assignedRep) {
        // Google Chat API integration
        // For now, using webhook as example
        
        const spaceName = `Customer: ${customerName} - ${new Date().toLocaleDateString()}`;
        
        // If using Google Chat API directly:
        // const response = await axios.post(
        //     'https://chat.googleapis.com/v1/spaces',
        //     { displayName: spaceName },
        //     { headers: { Authorization: `Bearer ${accessToken}` } }
        // );

        // Using webhook for demo
        const messageId = await this.sendWebhookMessage({
            text: `🆕 New conversation started: ${customerName}`,
            cards: [{
                header: {
                    title: 'New Customer Conversation',
                    subtitle: `Assigned to: ${assignedRep}`
                }
            }]
        });

        return {
            spaceId: `space_${Date.now()}`,
            threadId: messageId || `thread_${Date.now()}`
        };
    }

    /**
     * Post context message to Google Chat
     */
    async postContextMessage(spaceId, context) {
        const message = {
            text: `📋 **Conversation Context**\n\n` +
                  `**Customer:** ${context.customerName}\n` +
                  `**Email:** ${context.customerEmail}\n` +
                  `**Intent:** ${context.intent}\n` +
                  `**Reason:** ${context.handoffReason}\n\n` +
                  `**Assigned Rep:** ${context.assignedRep}\n\n` +
                  `---\n\n` +
                  `**Recent Conversation:**\n${this.formatConversation(context.conversationHistory)}`
        };

        await this.sendWebhookMessage(message);
    }

    /**
     * Send message via Google Chat webhook
     */
    async sendWebhookMessage(message) {
        if (!this.googleChatWebhookUrl) {
            logger.warn('Google Chat webhook URL not configured');
            return null;
        }

        try {
            const response = await axios.post(this.googleChatWebhookUrl, message, {
                timeout: 5000,
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            return response.data;
        } catch (error) {
            logger.error('Failed to send Google Chat message:', error.message);
            return null;
        }
    }

    /**
     * Notify sales rep
     */
    async notifySalesRep(repEmail, conversationInfo) {
        logger.info(`📧 Notifying sales rep: ${repEmail}`);
        
        // In production: Send email via SendGrid/AWS SES
        // For now, just log
        console.log(`
        ╔════════════════════════════════════════════╗
        📧 NEW CONVERSATION ASSIGNED
        ════════════════════════════════════════════
        Rep: ${repEmail}
        Customer: ${conversationInfo.customerName}
        Email: ${conversationInfo.customerEmail}
        Space: ${conversationInfo.spaceId}
        ╚════════════════════════════════════════════╝
        `);
    }

    /**
     * Format conversation history for display
     */
    formatConversation(history) {
        if (!Array.isArray(history)) {
            return 'No conversation history';
        }

        return history.slice(-5).map(msg => {
            const sender = msg.sender || 'Customer';
            const text = msg.text || msg.message || '';
            return `• ${sender}: ${text}`;
        }).join('\n');
    }

    /**
     * Close conversation
     */
    async closeConversation(customerId, resolution) {
        const conversation = this.activeConversations.get(customerId);
        
        if (!conversation) {
            return { success: false, error: 'Conversation not found' };
        }

        // Post closing message
        await this.sendWebhookMessage({
            text: `✅ Conversation resolved: ${resolution}`
        });

        // Update tracking
        this.activeConversations.set(customerId, {
            ...conversation,
            status: 'closed',
            closedAt: new Date().toISOString(),
            resolution
        });

        logger.info(`Conversation closed: ${customerId}`);

        return { success: true };
    }

    /**
     * Get active conversations
     */
    getActiveConversations() {
        return Array.from(this.activeConversations.values())
            .filter(conv => conv.status === 'active');
    }
}

module.exports = GoogleChatHandoff;
