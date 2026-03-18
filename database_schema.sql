-- Nitro ERP - Meta API Integration Database Schema
-- This schema defines the tables needed for Lead Ads and Unified Inbox integration

-- ============ LEADS TABLE ============
-- Stores all leads from Meta platforms (Facebook Lead Ads, etc.)

CREATE TABLE IF NOT EXISTS meta_leads (
    id SERIAL PRIMARY KEY,
    lead_id VARCHAR(100) UNIQUE NOT NULL,
    platform VARCHAR(20) NOT NULL DEFAULT 'facebook', -- 'facebook', 'instagram', 'whatsapp'
    source VARCHAR(50) NOT NULL DEFAULT 'facebook_lead_ads',
    ad_id VARCHAR(100),
    form_id VARCHAR(100),
    customer_name VARCHAR(255),
    email VARCHAR(255),
    phone_number VARCHAR(50),
    company VARCHAR(255),
    city VARCHAR(100),
    state VARCHAR(100),
    country VARCHAR(100),
    postal_code VARCHAR(20),
    message TEXT,
    status VARCHAR(20) DEFAULT 'new', -- 'new', 'contacted', 'qualified', 'converted', 'rejected'
    priority VARCHAR(20) DEFAULT 'medium', -- 'low', 'medium', 'high'
    tags TEXT[], -- Array of tags for categorization
    raw_data JSONB, -- Raw data from Meta API
    erp_customer_id INT, -- Link to customer in ERP
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    last_contacted_at TIMESTAMPTZ,
    CONSTRAINT valid_status CHECK (status IN ('new', 'contacted', 'qualified', 'converted', 'rejected')),
    CONSTRAINT valid_priority CHECK (priority IN ('low', 'medium', 'high'))
);

CREATE INDEX idx_meta_leads_lead_id ON meta_leads(lead_id);
CREATE INDEX idx_meta_leads_status ON meta_leads(status);
CREATE INDEX idx_meta_leads_platform ON meta_leads(platform);
CREATE INDEX idx_meta_leads_created_at ON meta_leads(created_at);

-- ============ UNIFIED INBOX TABLE ============
-- Stores all messages from Meta platforms (WhatsApp, Messenger, Instagram)

CREATE TABLE IF NOT EXISTS unified_inbox (
    id SERIAL PRIMARY KEY,
    platform VARCHAR(20) NOT NULL, -- 'whatsapp', 'instagram', 'facebook_messenger'
    customer_id VARCHAR(100) NOT NULL, -- Platform-specific user ID
    message_id VARCHAR(255) UNIQUE NOT NULL,
    message_body TEXT,
    message_type VARCHAR(50) DEFAULT 'text', -- 'text', 'image', 'document', 'audio', 'video'
    direction VARCHAR(10) NOT NULL, -- 'incoming', 'outgoing'
    status VARCHAR(20) DEFAULT 'received', -- 'sent', 'delivered', 'read', 'failed'
    media_url VARCHAR(500),
    media_type VARCHAR(50),
    sender_name VARCHAR(255),
    conversation_id VARCHAR(255),
    raw_data JSONB,
    erp_customer_id INT, -- Link to customer in ERP
    received_at TIMESTAMPTZ DEFAULT NOW(),
    processed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT valid_direction CHECK (direction IN ('incoming', 'outgoing')),
    CONSTRAINT valid_message_status CHECK (status IN ('sent', 'delivered', 'read', 'failed', 'received'))
);

CREATE INDEX idx_unified_inbox_platform ON unified_inbox(platform);
CREATE INDEX idx_unified_inbox_customer_id ON unified_inbox(customer_id);
CREATE INDEX idx_unified_inbox_conversation_id ON unified_inbox(conversation_id);
CREATE INDEX idx_unified_inbox_received_at ON unified_inbox(received_at);
CREATE INDEX idx_unified_inbox_status ON unified_inbox(status);

-- ============ CONVERSATIONS TABLE ============
-- Stores conversation threads between customers and the business

CREATE TABLE IF NOT EXISTS conversations (
    id SERIAL PRIMARY KEY,
    conversation_id VARCHAR(255) UNIQUE NOT NULL,
    platform VARCHAR(20) NOT NULL,
    customer_id VARCHAR(100) NOT NULL,
    erp_customer_id INT,
    subject VARCHAR(255),
    status VARCHAR(20) DEFAULT 'open', -- 'open', 'closed', 'archived'
    assigned_to INT, -- ERP user ID
    last_message_at TIMESTAMPTZ,
    message_count INT DEFAULT 0,
    tags TEXT[],
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT valid_conv_status CHECK (status IN ('open', 'closed', 'archived'))
);

CREATE INDEX idx_conversations_platform ON conversations(platform);
CREATE INDEX idx_conversations_customer_id ON conversations(customer_id);
CREATE INDEX idx_conversations_status ON conversations(status);
CREATE INDEX idx_conversations_assigned_to ON conversations(assigned_to);

-- ============ LEAD ACTIVITY LOG TABLE ============
-- Tracks all activities related to leads

CREATE TABLE IF NOT EXISTS lead_activities (
    id SERIAL PRIMARY KEY,
    lead_id VARCHAR(100) NOT NULL,
    activity_type VARCHAR(50) NOT NULL, -- 'created', 'contacted', 'status_changed', 'note_added', 'converted'
    description TEXT,
    performed_by INT, -- ERP user ID
    old_value VARCHAR(255),
    new_value VARCHAR(255),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    FOREIGN KEY (lead_id) REFERENCES meta_leads(lead_id) ON DELETE CASCADE
);

CREATE INDEX idx_lead_activities_lead_id ON lead_activities(lead_id);
CREATE INDEX idx_lead_activities_activity_type ON lead_activities(activity_type);
CREATE INDEX idx_lead_activities_created_at ON lead_activities(created_at);

-- ============ META API TOKENS TABLE ============
-- Stores encrypted Meta API tokens for different platforms

CREATE TABLE IF NOT EXISTS meta_api_tokens (
    id SERIAL PRIMARY KEY,
    platform VARCHAR(20) NOT NULL UNIQUE, -- 'whatsapp', 'facebook', 'instagram'
    access_token TEXT NOT NULL, -- Encrypted in production
    token_type VARCHAR(50) DEFAULT 'access_token',
    expires_at TIMESTAMPTZ,
    scope TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT valid_platform CHECK (platform IN ('whatsapp', 'facebook', 'instagram'))
);

-- ============ WEBHOOK LOG TABLE ============
-- Logs all incoming webhooks for debugging and auditing

CREATE TABLE IF NOT EXISTS webhook_logs (
    id SERIAL PRIMARY KEY,
    platform VARCHAR(20) NOT NULL,
    webhook_type VARCHAR(50) NOT NULL, -- 'message', 'leadgen', 'status_update'
    payload JSONB,
    status VARCHAR(20) DEFAULT 'received', -- 'received', 'processed', 'failed'
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    processed_at TIMESTAMPTZ
);

CREATE INDEX idx_webhook_logs_platform ON webhook_logs(platform);
CREATE INDEX idx_webhook_logs_webhook_type ON webhook_logs(webhook_type);
CREATE INDEX idx_webhook_logs_status ON webhook_logs(status);
CREATE INDEX idx_webhook_logs_created_at ON webhook_logs(created_at);

-- ============ VIEWS ============

-- View for recent leads
CREATE OR REPLACE VIEW recent_leads AS
SELECT 
    id,
    lead_id,
    customer_name,
    email,
    phone_number,
    status,
    priority,
    platform,
    created_at,
    updated_at
FROM meta_leads
WHERE created_at > NOW() - INTERVAL '30 days'
ORDER BY created_at DESC;

-- View for open conversations
CREATE OR REPLACE VIEW open_conversations AS
SELECT 
    c.id,
    c.conversation_id,
    c.platform,
    c.customer_id,
    c.subject,
    c.assigned_to,
    c.last_message_at,
    c.message_count,
    COUNT(m.id) as unread_count
FROM conversations c
LEFT JOIN unified_inbox m ON c.conversation_id = m.conversation_id AND m.status != 'read'
WHERE c.status = 'open'
GROUP BY c.id, c.conversation_id, c.platform, c.customer_id, c.subject, c.assigned_to, c.last_message_at, c.message_count
ORDER BY c.last_message_at DESC;

-- ============ FUNCTIONS ============

-- Function to update lead status and log activity
CREATE OR REPLACE FUNCTION update_lead_status(
    p_lead_id VARCHAR(100),
    p_new_status VARCHAR(20),
    p_performed_by INT
)
RETURNS TABLE(success BOOLEAN, message VARCHAR) AS $$
BEGIN
    UPDATE meta_leads
    SET status = p_new_status, updated_at = NOW()
    WHERE lead_id = p_lead_id;
    
    INSERT INTO lead_activities (lead_id, activity_type, description, performed_by, old_value, new_value)
    SELECT lead_id, 'status_changed', 'Status changed', p_performed_by, 
           (SELECT status FROM meta_leads WHERE lead_id = p_lead_id), p_new_status
    FROM meta_leads
    WHERE lead_id = p_lead_id;
    
    RETURN QUERY SELECT TRUE::BOOLEAN, 'Lead status updated successfully'::VARCHAR;
END;
$$ LANGUAGE plpgsql;

-- Function to get lead statistics
CREATE OR REPLACE FUNCTION get_lead_statistics()
RETURNS TABLE(
    total_leads BIGINT,
    new_leads BIGINT,
    contacted_leads BIGINT,
    qualified_leads BIGINT,
    converted_leads BIGINT,
    high_priority_leads BIGINT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        COUNT(*) as total_leads,
        COUNT(*) FILTER (WHERE status = 'new') as new_leads,
        COUNT(*) FILTER (WHERE status = 'contacted') as contacted_leads,
        COUNT(*) FILTER (WHERE status = 'qualified') as qualified_leads,
        COUNT(*) FILTER (WHERE status = 'converted') as converted_leads,
        COUNT(*) FILTER (WHERE priority = 'high') as high_priority_leads
    FROM meta_leads;
END;
$$ LANGUAGE plpgsql;
