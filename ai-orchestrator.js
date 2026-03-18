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
        new winston.transports.File({ filename: 'logs/ai-orchestrator.log' })
    ]
});

/**
 * AI Orchestrator - Intent Detection & Auto-Reply
 * 
 * Use cases:
 * 1. Price inquiry → Auto-reply with pricing info OR handoff to human
 * 2. Product info → Send catalog
 * 3. Complaint → Escalate to human immediately
 * 4. General question → AI response
 */
class AIOrchestrator {
    constructor(config = {}) {
        this.openaiApiKey = config.openaiApiKey || process.env.OPENAI_API_KEY;
        this.openaiEndpoint = 'https://api.openai.com/v1/chat/completions';
        this.model = config.model || 'gpt-4o-mini';
        
        // Intent classification
        this.intents = {
            PRICE_INQUIRY: 'price_inquiry',
            PRODUCT_INFO: 'product_info',
            COMPLAINT: 'complaint',
            SUPPORT: 'support',
            GENERAL: 'general',
            HANDOFF_REQUIRED: 'handoff_required'
        };
        
        // Keywords for intent detection (fallback if no AI)
        this.intentKeywords = {
            [this.intents.PRICE_INQUIRY]: ['fiyat', 'ücret', 'maliyet', 'cost', 'price', 'quote', 'teklif'],
            [this.intents.COMPLAINT]: ['şikayet', 'kötü', 'berbat', 'memnun değilim', 'complaint', 'bad', 'terrible'],
            [this.intents.PRODUCT_INFO]: ['ürün', 'product', 'özellik', 'specification', 'catalog', 'katalog'],
            [this.intents.SUPPORT]: ['yardım', 'help', 'support', 'destek', 'nasıl', 'how to'],
            [this.intents.HANDOFF_REQUIRED]: ['insan', 'human', 'temsilci', 'agent', 'canlı', 'live']
        };
    }

    /**
     * Process incoming message
     * Returns: { intent, confidence, reply, shouldHandoff }
     */
    async processMessage(message, context = {}) {
        const startTime = Date.now();
        
        try {
            // Step 1: Detect intent
            const intentAnalysis = await this.detectIntent(message);
            
            logger.info(`🎯 Intent detected: ${intentAnalysis.intent} (confidence: ${intentAnalysis.confidence})`);
            
            // Step 2: Generate response based on intent
            let response;
            switch (intentAnalysis.intent) {
                case this.intents.PRICE_INQUIRY:
                    response = await this.handlePriceInquiry(message, context);
                    break;
                    
                case this.intents.COMPLAINT:
                    response = await this.handleComplaint(message, context);
                    break;
                    
                case this.intents.PRODUCT_INFO:
                    response = await this.handleProductInfo(message, context);
                    break;
                    
                case this.intents.SUPPORT:
                    response = await this.handleSupport(message, context);
                    break;
                    
                default:
                    response = await this.handleGeneral(message, context);
            }
            
            const processingTime = Date.now() - startTime;
            
            return {
                intent: intentAnalysis.intent,
                confidence: intentAnalysis.confidence,
                reply: response.reply,
                shouldHandoff: response.shouldHandoff,
                handoffReason: response.handoffReason,
                metadata: {
                    processing_time_ms: processingTime,
                    model_used: this.model
                }
            };
            
        } catch (error) {
            logger.error('AI processing failed:', error.message);
            
            // Fallback to rule-based intent
            const fallbackIntent = this.detectIntentFallback(message);
            
            return {
                intent: fallbackIntent,
                confidence: 0.5,
                reply: this.getFallbackResponse(fallbackIntent),
                shouldHandoff: fallbackIntent === this.intents.COMPLAINT,
                metadata: {
                    fallback: true,
                    error: error.message
                }
            };
        }
    }

    /**
     * Detect intent using OpenAI
     */
    async detectIntent(message) {
        if (!this.openaiApiKey) {
            // Fallback to keyword-based detection
            return this.detectIntentFallback(message);
        }
        
        try {
            const response = await axios.post(this.openaiEndpoint, {
                model: this.model,
                messages: [
                    {
                        role: 'system',
                        content: `You are an intent classifier for customer service messages.
Classify the message into one of these intents:
- price_inquiry: Asking about price, cost, quote
- product_info: Asking about product features, specifications
- complaint: Expressing dissatisfaction, complaint
- support: Asking for help, technical support
- general: General conversation, greeting
- handoff_required: Explicitly requesting human agent

Respond in JSON format: {"intent": "intent_name", "confidence": 0.95}`
                    },
                    {
                        role: 'user',
                        content: message
                    }
                ],
                temperature: 0.1,
                max_tokens: 50
            }, {
                headers: {
                    'Authorization': `Bearer ${this.openaiApiKey}`,
                    'Content-Type': 'application/json'
                },
                timeout: 5000
            });
            
            const content = response.data.choices[0].message.content.trim();
            const parsed = JSON.parse(content);
            
            return {
                intent: parsed.intent,
                confidence: parsed.confidence || 0.8
            };
            
        } catch (error) {
            logger.warn('OpenAI intent detection failed, using fallback:', error.message);
            return this.detectIntentFallback(message);
        }
    }

    /**
     * Fallback keyword-based intent detection
     */
    detectIntentFallback(message) {
        const lowerMessage = message.toLowerCase();
        
        for (const [intent, keywords] of Object.entries(this.intentKeywords)) {
            for (const keyword of keywords) {
                if (lowerMessage.includes(keyword)) {
                    return intent;
                }
            }
        }
        
        return this.intents.GENERAL;
    }

    /**
     * Handle price inquiry
     */
    async handlePriceInquiry(message, context) {
        // If confidence is low or complex pricing, handoff to human
        const needsHumanHelp = message.includes('karmaşık') || message.includes('custom') || message.includes('enterprise');
        
        if (needsHumanHelp) {
            return {
                reply: 'Fiyatlandırma konusunda size daha iyi yardımcı olabilmemiz için bir satış temsilcimiz sizin iletişime geçecek.',
                shouldHandoff: true,
                handoffReason: 'Complex pricing inquiry requires human assistance'
            };
        }
        
        // Auto-reply with standard pricing
        return {
            reply: 'Ürünlerimiz hakkında genel fiyat bilgisi için web sitemizi ziyaret edebilirsiniz: https://nitrobilisim.com/fiyatlar. Özel teklif için lütfen satış ekibimizle iletişime geçin.',
            shouldHandoff: false
        };
    }

    /**
     * Handle complaint - ALWAYS handoff
     */
    async handleComplaint(message, context) {
        return {
            reply: 'Yaşadığınız sorun için özür dileriz. Müşteri hizmetleri temsilcimiz en kısa sürede sizinle iletişime geçecek.',
            shouldHandoff: true,
            handoffReason: 'Customer complaint requires immediate human attention'
        };
    }

    /**
     * Handle product info request
     */
    async handleProductInfo(message, context) {
        return {
            reply: 'Ürün kataloğumuzu incelemek için: https://nitrobilisim.com/urunler. Detaylı bilgi için teknik ekibimizle görüşmek ister misiniz?',
            shouldHandoff: false
        };
    }

    /**
     * Handle support request
     */
    async handleSupport(message, context) {
        const needsTechnicalSupport = message.includes('teknik') || message.includes('bug') || message.includes('error');
        
        if (needsTechnicalSupport) {
            return {
                reply: 'Teknik destek talebinizi aldık. Uzman ekibimiz en kısa sürede size dönüş yapacak.',
                shouldHandoff: true,
                handoffReason: 'Technical support request'
            };
        }
        
        return {
            reply: 'Size nasıl yardımcı olabilirim? Daha detaylı bilgi verebilir misiniz?',
            shouldHandoff: false
        };
    }

    /**
     * Handle general message
     */
    async handleGeneral(message, context) {
        return {
            reply: 'Merhaba! Size nasıl yardımcı olabilirim?',
            shouldHandoff: false
        };
    }

    /**
     * Fallback responses
     */
    getFallbackResponse(intent) {
        const responses = {
            [this.intents.PRICE_INQUIRY]: 'Fiyat bilgisi için web sitemizi ziyaret edebilirsiniz.',
            [this.intents.COMPLAINT]: 'Yaşadığınız sorun için üzgünüz. Ekibimiz sizinle iletişime geçecek.',
            [this.intents.PRODUCT_INFO]: 'Ürün bilgilerimiz için web sitemizi inceleyebilirsiniz.',
            [this.intents.SUPPORT]: 'Size nasıl yardımcı olabiliriz?',
            [this.intents.GENERAL]: 'Merhaba! Nasıl yardımcı olabilirim?'
        };
        
        return responses[intent] || 'Merhaba! Size nasıl yardımcı olabilirim?';
    }

    /**
     * Log conversation for analytics
     */
    async logConversation(data) {
        logger.info('💬 Conversation logged:', data);
        // In production: Insert into conversations table
    }
}

module.exports = AIOrchestrator;
