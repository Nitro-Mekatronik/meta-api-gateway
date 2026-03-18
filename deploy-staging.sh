#!/bin/bash

set -e

echo "🚀 Starting Staging Deployment..."

# Configuration
STAGING_DIR="/opt/staging/meta-api-gateway"

# Step 1: Pull latest code
echo "📦 Pulling latest code from GitHub..."
cd $STAGING_DIR || exit 1
git pull origin main

# Step 2: Check Docker is running
echo "🐳 Checking Docker..."
if ! docker --version > /dev/null 2>&1; then
    echo "❌ Docker is not installed. Please install Docker first."
    exit 1
fi

if ! docker-compose --version > /dev/null 2>&1; then
    echo "❌ docker-compose is not installed. Please install docker-compose first."
    exit 1
fi

echo "✅ Docker is ready"

# Step 3: Verify environment file exists
if [ ! -f .env.production ]; then
    echo "⚠️  .env.production not found. Creating from .env.example..."
    cp .env.example .env.production
    echo "📝 Please edit .env.production with your production values!"
    echo "   Required variables:"
    echo "   - META_WEBHOOK_VERIFY_TOKEN"
    echo "   - META_APP_SECRET"
    echo "   - META_ACCESS_TOKEN"
    echo "   - DATABASE_URL"
    echo ""
    echo "Stopping here. Please configure .env.production and run again."
    exit 1
fi

echo "✅ Environment file found"

# Step 4: Stop existing containers
echo "⏹️  Stopping existing containers..."
docker-compose down

# Step 5: Start new containers
echo "🚀 Starting new containers..."
docker-compose up -d

# Step 6: Wait for services to be ready
echo "⏳ Waiting for services to be ready (30 seconds)..."
sleep 30

# Step 7: Health checks
echo "🏥 Running health checks..."

# Check API Gateway
HEALTH_RESPONSE=$(curl -s http://localhost:3000/health || echo '{"status":"FAILED"}')
if echo "$HEALTH_RESPONSE" | grep -q "OK"; then
    echo "✅ API Gateway is healthy"
else
    echo "❌ API Gateway health check failed"
    echo "Response: $HEALTH_RESPONSE"
    echo "Check logs: docker-compose logs api-gateway"
    exit 1
fi

# Step 8: Check all containers
echo "📊 Container status:"
docker-compose ps

# Step 9: Show recent logs
echo "📜 Recent logs (last 20 lines):"
docker-compose logs --tail=20

# Step 10: Display service URLs
echo ""
echo "========================================="
echo "✅ STAGING DEPLOYMENT COMPLETED SUCCESSFULLY!"
echo "========================================="
echo ""
echo "Service URLs:"
echo "  🌐 API Gateway: http://localhost:3000"
echo "  📊 Health Check: http://localhost:3000/health"
echo "  📈 Metrics: http://localhost:3000/metrics"
echo ""
echo "Docker Services:"
echo "  - API Gateway (port 3000)"
echo "  - Worker (background processing)"
echo "  - Redis (queue backend)"
echo "  - PostgreSQL (database)"
echo ""
echo "Useful Commands:"
echo "  View logs:     docker-compose logs -f"
echo "  Stop:          docker-compose down"
echo "  Restart:       docker-compose restart"
echo "  Scale worker:  docker-compose up -d --scale worker=3"
echo ""
echo "Next Steps:"
echo "  1. Run smoke tests"
echo "  2. Configure monitoring"
echo "  3. Setup log aggregation"
echo "  4. Prepare for production deployment"
echo ""
echo "========================================="
