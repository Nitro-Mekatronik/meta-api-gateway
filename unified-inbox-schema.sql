-- Unified Inbox Schema for ERP Integration
-- This schema supports multi-channel conversations (Meta, WhatsApp, Google Chat, etc.)

-- Conversations table
CREATE TABLE IF NOT EXISTS conversations (
    id SERIAL PRIMARY KEY,
    conversation_id VARCHAR(255) UNIQUE NOT NULL,
    platform VARCHAR(50) NOT NULL, -- facebook, whatsapp, google_chat, web
    customer_id VARCHAR(255),
    customer_name VARCHAR(255),
    customer_email VARCHAR(255),
    customer_phone VARCHAR(50),
    
    -- Assignment
    assigned_rep_id VARCHAR(100),
    assigned_rep_email VARCHAR(255),
    team_id VARCHAR(100),
    
    -- Status tracking
    status VARCHAR(50) DEFAULT 'open', -- open, in_progress, waiting_customer, resolved, closed
    priority VARCHAR(20) DEFAULT 'normal', -- normal, high, urgent
    source VARCHAR(100), -- lead_ads, message, comment, story
    
    -- Handoff tracking
    handoff_status VARCHAR(50) DEFAULT 'ai', -- ai, human_requested, human_assigned, human_active
    handoff_initiated_at TIMESTAMP,
    handoff_accepted_at TIMESTAMP,
    handoff_completed_at TIMESTAMP,
    
    -- AI metadata
    detected_intent VARCHAR(100),
    ai_confidence DECIMAL(3,2),
    auto_reply_sent BOOLEAN DEFAULT FALSE,
    
    -- Timestamps
    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_activity_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    resolved_at TIMESTAMP,
    closed_at TIMESTAMP,
    
    -- Metadata
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX idx_conversations_platform ON conversations(platform);
CREATE INDEX idx_conversations_customer_id ON conversations(customer_id);
CREATE INDEX idx_conversations_assigned_rep ON conversations(assigned_rep_id);
CREATE INDEX idx_conversations_status ON conversations(status);
CREATE INDEX idx_conversations_handoff_status ON conversations(handoff_status);
CREATE INDEX idx_conversations_created_at ON conversations(created_at);
CREATE INDEX idx_conversations_last_activity ON conversations(last_activity_at);

-- Messages table
CREATE TABLE IF NOT EXISTS messages (
    id SERIAL PRIMARY KEY,
    message_id VARCHAR(255) UNIQUE NOT NULL,
    conversation_id INTEGER REFERENCES conversations(id) ON DELETE CASCADE,
    
    -- Message details
    platform VARCHAR(50) NOT NULL,
    platform_message_id VARCHAR(255), -- Original message ID from platform
    
    -- Sender
    sender_type VARCHAR(50) NOT NULL, -- customer, rep, ai, system
    sender_id VARCHAR(255),
    sender_name VARCHAR(255),
    
    -- Content
    message_type VARCHAR(50) DEFAULT 'text', -- text, image, video, file, quick_reply
    content TEXT NOT NULL,
    attachments JSONB DEFAULT '[]',
    
    -- Metadata
    is_auto_reply BOOLEAN DEFAULT FALSE,
    intent_detected VARCHAR(100),
    sentiment_score DECIMAL(3,2),
    
    -- Delivery tracking
    delivered BOOLEAN DEFAULT FALSE,
    read BOOLEAN DEFAULT FALSE,
    delivered_at TIMESTAMP,
    read_at TIMESTAMP,
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for messages
CREATE INDEX idx_messages_conversation_id ON messages(conversation_id);
CREATE INDEX idx_messages_platform ON messages(platform);
CREATE INDEX idx_messages_sender_type ON messages(sender_type);
CREATE INDEX idx_messages_created_at ON messages(created_at);

-- Conversation tags
CREATE TABLE IF NOT EXISTS conversation_tags (
    id SERIAL PRIMARY KEY,
    conversation_id INTEGER REFERENCES conversations(id) ON DELETE CASCADE,
    tag VARCHAR(100) NOT NULL,
    created_by VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_conversation_tags_conversation_id ON conversation_tags(conversation_id);
CREATE INDEX idx_conversation_tags_tag ON conversation_tags(tag);

-- Rep availability and workload
CREATE TABLE IF NOT EXISTS rep_availability (
    id SERIAL PRIMARY KEY,
    rep_id VARCHAR(100) NOT NULL,
    rep_email VARCHAR(255) NOT NULL,
    status VARCHAR(50) DEFAULT 'available', -- available, busy, away, offline
    current_conversations INTEGER DEFAULT 0,
    max_conversations INTEGER DEFAULT 10,
    skills JSONB DEFAULT '[]', -- ['price_inquiry', 'technical_support', 'complaints']
    last_activity_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_rep_availability_rep_id ON rep_availability(rep_id);
CREATE INDEX idx_rep_availability_status ON rep_availability(status);

-- SLA tracking
CREATE TABLE IF NOT EXISTS conversation_sla (
    id SERIAL PRIMARY KEY,
    conversation_id INTEGER REFERENCES conversations(id) ON DELETE CASCADE,
    
    -- Response time SLA
    first_response_time_seconds INTEGER,
    first_response_sla_met BOOLEAN,
    
    -- Resolution time SLA
    resolution_time_seconds INTEGER,
    resolution_sla_met BOOLEAN,
    
    -- Breach tracking
    breached BOOLEAN DEFAULT FALSE,
    breach_reason VARCHAR(255),
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_conversation_sla_conversation_id ON conversation_sla(conversation_id);
CREATE INDEX idx_conversation_sla_breached ON conversation_sla(breached);

-- Analytics view
CREATE OR REPLACE VIEW conversation_analytics AS
SELECT 
    DATE(c.created_at) as date,
    c.platform,
    c.detected_intent,
    COUNT(*) as total_conversations,
    COUNT(CASE WHEN c.status = 'resolved' THEN 1 END) as resolved_count,
    COUNT(CASE WHEN c.handoff_status LIKE 'human%' THEN 1 END) as human_handoffs,
    AVG(EXTRACT(EPOCH FROM (c.resolved_at - c.started_at))) as avg_resolution_time_seconds,
    AVG(c.ai_confidence) as avg_ai_confidence
FROM conversations c
GROUP BY DATE(c.created_at), c.platform, c.detected_intent;

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_conversations_updated_at
    BEFORE UPDATE ON conversations
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Sample data insertion for testing
INSERT INTO rep_availability (rep_id, rep_email, status, max_conversations, skills) VALUES
('rep_001', 'ahmet@nitrobilisim.com', 'available', 10, '["price_inquiry", "general"]'),
('rep_002', 'ayse@nitrobilisim.com', 'available', 10, '["technical_support", "complaints"]'),
('rep_003', 'mehmet@nitrobilisim.com', 'busy', 10, '["price_inquiry", "product_info"]')
ON CONFLICT DO NOTHING;
