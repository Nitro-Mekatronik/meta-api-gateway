# 🚀 Meta API Gateway - Production Deployment Guide

## Quick Start

### 1. Prerequisites

- Docker & Docker Compose
- Node.js 18+ (for local development)
- PostgreSQL client (psql)
- Redis CLI (optional)

### 2. One-Command Deployment

```bash
# Clone and enter directory
cd metaapierp

# Copy environment file
cp .env.example .env

# Edit environment variables
vim .env  # Add your API keys

# Start all services
docker-compose up -d

# Check status
docker-compose ps

# View logs
docker-compose logs -f api-gateway
docker-compose logs -f worker
```

### 3. Verify Deployment

```bash
# Health check
curl http://localhost:3000/health

# Metrics endpoint
curl http://localhost:3000/metrics

# Test webhook verification
curl "http://localhost:3000/api/meta/webhook?hub.mode=subscribe&hub.verify_token=test-token&hub.challenge=challenge123"
```

---

## Environment Configuration

### Required Variables

```bash
# .env file

# Meta Platform
META_WEBHOOK_VERIFY_TOKEN=your_verify_token_here
META_APP_SECRET=your_app_secret_here

# AI (OpenAI)
OPENAI_API_KEY=sk-proj-xxx

# Google Chat (optional)
GOOGLE_CHAT_WEBHOOK_URL=https://chat.googleapis.com/...

# ERP Integration
NITRO_ERP_URL=http://your-erp-server:5000
```

### Optional Variables

```bash
# Rate Limiting
WEBHOOK_RATE_LIMIT_WINDOW_MS=60000
WEBHOOK_RATE_LIMIT_MAX=1000
WHATSAPP_RATE_LIMIT_WINDOW_MS=60000
WHATSAPP_RATE_LIMIT_MAX=100

# Logging
LOG_LEVEL=info  # debug, info, warn, error

# Database
DATABASE_URL=postgresql://meta_user:meta_password@postgres:5432/nitro_meta_erp
```

---

## Services Overview

### Port Mapping

| Service | Internal Port | External Port | Description |
|---------|--------------|---------------|-------------|
| API Gateway | 3000 | 3000 | Express application |
| Worker | N/A | N/A | Queue processor (scaled x2) |
| Redis | 6379 | 6379 | Message broker |
| PostgreSQL | 5432 | 5432 | Database |

### Health Checks

**Redis:**
```bash
docker exec meta-redis redis-cli ping
# Output: PONG
```

**PostgreSQL:**
```bash
docker exec meta-postgres pg_isready -U meta_user -d nitro_meta_erp
# Output: accepting connections
```

**API Gateway:**
```bash
curl http://localhost:3000/health
```

**Worker:**
```bash
docker logs meta-worker
# Look for: "Workers started successfully"
```

---

## Database Setup

### Automatic Migration

Migrations run automatically on first startup:

1. `database-migrations.sql` → Idempotency constraints
2. `unified-inbox-schema.sql` → Conversations schema

### Manual Migration

```bash
# Connect to database
docker exec -it meta-postgres psql -U meta_user -d nitro_meta_erp

# Run migrations manually
\i /docker-entrypoint-initdb.d/01-migrations.sql
\i /docker-entrypoint-initdb.d/02-unified-inbox.sql

# Verify tables
\d meta_leads
\d conversations
\d messages
```

### Backup & Restore

**Backup:**
```bash
docker exec meta-postgres pg_dump -U meta_user nitro_meta_erp > backup.sql
```

**Restore:**
```bash
cat backup.sql | docker exec -i meta-postgres psql -U meta_user -d nitro_meta_erp
```

---

## Monitoring

### Prometheus Metrics

Access metrics at: `http://localhost:3000/metrics`

**Key Metrics:**
- `webhooks_received_total` - Total webhooks received
- `webhook_processing_duration_seconds` - Processing time histogram
- `nodejs_heap_size_bytes` - Memory usage
- `nodejs_eventloop_lag_seconds` - Event loop lag

### Grafana Dashboard (Optional)

```yaml
# Add to docker-compose.yml
grafana:
  image: grafana/grafana:latest
  ports:
    - "3001:3000"
  environment:
    - GF_SECURITY_ADMIN_PASSWORD=admin
  volumes:
    - grafana_data:/var/lib/grafana
```

### Log Access

```bash
# All services
docker-compose logs -f

# Specific service
docker-compose logs -f api-gateway
docker-compose logs -f worker

# Last 100 lines
docker-compose logs --tail=100 worker
```

---

## Scaling

### Horizontal Scaling (Workers)

Edit `docker-compose.yml`:

```yaml
worker:
  deploy:
    replicas: 4  # Increase from 2 to 4
```

Apply changes:
```bash
docker-compose up -d --scale worker=4
```

### Vertical Scaling (Resources)

```yaml
api-gateway:
  deploy:
    resources:
      limits:
        cpus: '2'
        memory: 2G
      reservations:
        cpus: '0.5'
        memory: 512M
```

---

## Troubleshooting

### Issue: Container Won't Start

```bash
# Check logs
docker-compose logs api-gateway

# Common issues:
# 1. Port already in use
# 2. Missing environment variables
# 3. Database connection failed

# Fix: Restart with fresh build
docker-compose down -v
docker-compose up -d --build
```

### Issue: Queue Not Processing

```bash
# Check Redis connection
docker exec meta-redis redis-cli ping

# Check queue status
docker exec meta-redis redis-cli KEYS '*'
docker exec meta-redis redis-cli LLEN webhook-queue

# Restart workers
docker-compose restart worker
```

### Issue: Database Connection Failed

```bash
# Check PostgreSQL status
docker exec meta-postgres pg_isready

# Check connection string
docker exec meta-api-gateway env | grep DATABASE_URL

# Restart database
docker-compose restart postgres
```

### Issue: High Memory Usage

```bash
# Check container stats
docker stats

# Restart if needed
docker-compose restart api-gateway worker

# Enable Node.js garbage collection
NODE_OPTIONS="--max-old-space-size=2048"
```

---

## Security Hardening

### Production Checklist

- [ ] Change default passwords in `.env`
- [ ] Enable SSL/TLS for external access
- [ ] Configure firewall rules
- [ ] Set `NODE_ENV=production`
- [ ] Enable rate limiting
- [ ] Configure log rotation
- [ ] Set up monitoring alerts
- [ ] Regular security updates

### Firewall Rules

```bash
# Allow only necessary ports
ufw allow 3000/tcp  # API Gateway
ufw allow 5432/tcp  # PostgreSQL (internal only recommended)
ufw allow 6379/tcp  # Redis (internal only recommended)
ufw enable
```

### SSL with Nginx (Optional)

```nginx
server {
    listen 443 ssl;
    server_name api.yourdomain.com;

    ssl_certificate /etc/ssl/certs/your-cert.pem;
    ssl_certificate_key /etc/ssl/private/your-key.pem;

    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

---

## CI/CD Integration

### GitHub Actions Example

```yaml
name: Deploy

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Build and Deploy
        run: |
          docker-compose build
          docker-compose up -d
      
      - name: Health Check
        run: |
          curl http://localhost:3000/health
```

---

## Performance Tuning

### Redis Optimization

```conf
# redis.conf (mount as volume)
maxmemory 2gb
maxmemory-policy allkeys-lru
appendonly yes
appendfsync everysec
```

### PostgreSQL Optimization

```conf
# postgresql.conf (mount as volume)
shared_buffers = 256MB
effective_cache_size = 1GB
work_mem = 16MB
maintenance_work_mem = 128MB
```

### Node.js Optimization

```bash
# Environment variables
NODE_OPTIONS="--max-old-space-size=2048"
NODE_ENV=production
```

---

## Maintenance

### Update Application

```bash
# Pull latest code
git pull origin main

# Rebuild and restart
docker-compose build
docker-compose up -d

# Clean up old images
docker image prune -f
```

### Database Maintenance

```bash
# Vacuum analyze
docker exec meta-postgres psql -U meta_user -d nitro_meta_erp -c "VACUUM ANALYZE;"

# Check table sizes
docker exec meta-postgres psql -U meta_user -d nitro_meta_erp -c "\dt+"
```

### Log Rotation

```yaml
# docker-compose.yml
services:
  api-gateway:
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"
```

---

## Support

For issues or questions:

1. Check logs: `docker-compose logs -f`
2. Review documentation: `/README.md`
3. Contact technical team

---

**Version:** 1.0.0  
**Last Updated:** 2026-03-19  
**Status:** Production Ready ✅
