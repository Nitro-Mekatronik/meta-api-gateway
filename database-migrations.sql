-- Idempotency: Prevent duplicate leads
ALTER TABLE meta_leads ADD CONSTRAINT unique_lead_id UNIQUE (lead_id);

-- Add processing status tracking
ALTER TABLE meta_leads 
ADD COLUMN IF NOT EXISTS processed_at TIMESTAMP,
ADD COLUMN IF NOT EXISTS queue_status VARCHAR(50) DEFAULT 'pending',
ADD COLUMN IF NOT EXISTS retry_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS error_message TEXT;

-- Create dead letter table for failed jobs
CREATE TABLE IF NOT EXISTS dead_letter_queue (
    id SERIAL PRIMARY KEY,
    job_type VARCHAR(100) NOT NULL,
    job_id VARCHAR(255) NOT NULL,
    payload JSONB NOT NULL,
    error_message TEXT NOT NULL,
    attempts INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    resolved BOOLEAN DEFAULT FALSE,
    resolved_at TIMESTAMP,
    resolved_by VARCHAR(255)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_dead_letter_job_type ON dead_letter_queue(job_type);
CREATE INDEX IF NOT EXISTS idx_dead_letter_created_at ON dead_letter_queue(created_at);
CREATE INDEX IF NOT EXISTS idx_dead_letter_resolved ON dead_letter_queue(resolved);

-- Queue metrics table
CREATE TABLE IF NOT EXISTS queue_metrics (
    id SERIAL PRIMARY KEY,
    queue_name VARCHAR(100) NOT NULL,
    job_id VARCHAR(255) NOT NULL,
    status VARCHAR(50) NOT NULL, -- pending, processing, completed, failed
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    duration_ms INTEGER,
    attempts INTEGER DEFAULT 0,
    error_message TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for metrics
CREATE INDEX IF NOT EXISTS idx_queue_metrics_name ON queue_metrics(queue_name);
CREATE INDEX IF NOT EXISTS idx_queue_metrics_status ON queue_metrics(status);
CREATE INDEX IF NOT EXISTS idx_queue_metrics_created_at ON queue_metrics(created_at);

-- Audit log for webhook events
CREATE TABLE IF NOT EXISTS webhook_audit_log (
    id SERIAL PRIMARY KEY,
    event_type VARCHAR(100) NOT NULL,
    lead_id VARCHAR(255),
    signature_verified BOOLEAN DEFAULT FALSE,
    raw_payload JSONB NOT NULL,
    ip_address INET,
    user_agent TEXT,
    processed BOOLEAN DEFAULT FALSE,
    error_message TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for audit
CREATE INDEX IF NOT EXISTS idx_webhook_audit_event_type ON webhook_audit_log(event_type);
CREATE INDEX IF NOT EXISTS idx_webhook_audit_lead_id ON webhook_audit_log(lead_id);
CREATE INDEX IF NOT EXISTS idx_webhook_audit_created_at ON webhook_audit_log(created_at);
