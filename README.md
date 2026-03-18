# Nitro Meta API Gateway

[![Tests](https://img.shields.io/badge/tests-84%25-yellow)]()
[![Coverage](https://img.shields.io/badge/coverage-65%25-blue)]()
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-green)]()
[![License](https://img.shields.io/badge/license-MIT-blue)]()

**WhatsApp + Meta (Facebook/Instagram) mesajlarını AI ile işleyip Google Chat'e aktaran enterprise otomasyon sistemi.**

---

## 🎯 Özellikler

### Core Features
- ✅ **Multi-Platform Support**: WhatsApp, Facebook, Instagram
- ✅ **AI-Powered Responses**: OpenAI GPT-4 ile niyet algılama
- ✅ **Smart Handoff**: Karmaşık durumları Google Chat'e aktar
- ✅ **Lead Ads Automation**: Meta Lead Ads → ERP otomatik entegrasyon
- ✅ **Webhook Security**: HMAC SHA256 imza doğrulama
- ✅ **Queue-Based Processing**: BullMQ + Redis ile güvenilir işlem

### Enterprise Ready
- ✅ **Idempotency**: Duplicate lead önleme
- ✅ **Rate Limiting**: Endpoint bazlı koruma
- ✅ **Dead Letter Queue**: Başarısız job'ları takip
- ✅ **Retry Logic**: Otomatik tekrar deneme
- ✅ **Observability**: Prometheus metrics + structured logging
- ✅ **Health Checks**: Canlılık kontrolleri

---

## 🏗️ Mimari

```
┌─────────────────┐
│   Customers     │
│ WhatsApp/Meta   │
└────────┬────────┘
         │
         ↓
┌───────────────────┐
│  API Gateway      │
│  (Express + Queue)│
└────────┬──────────┘
         │ Redis
         ↓
┌───────────────────────┐
│  Worker Service       │
│                       │
│ ┌──────────────────┐  │
│ │ Message Worker   │  │
│ │ + AI Orchestra   │  │
│ │ + Auto Reply     │  │
│ └──────────────────┘  │
│                       │
│ ┌──────────────────┐  │
│ │ Google Chat      │  │
│ │ Handoff Worker   │  │
│ └──────────────────┘  │
└─────────┬─────────────┘
          │
    ┌─────┴─────┐
    ↓           ↓
┌───────┐   ┌──────────┐
│ ERP   │   │ Google   │
│       │   │  Chat    │
└───────┘   └──────────┘
```

---

## 🚀 Hızlı Başlangıç

### Gereksinimler
- Node.js 18+
- Docker & Docker Compose
- PostgreSQL 14+
- Redis 7+

### Kurulum

```bash
# Repository'yi klonla
git clone https://github.com/Nitro-Mekatronik/meta-api-gateway.git
cd meta-api-gateway

# Dependencies yükle
npm install

# Environment ayarla
cp .env.example .env
vim .env  # API key'leri ekle
```

### Docker ile Başlatma

```bash
# Tüm servisleri başlat
docker-compose up -d

# Status kontrol
docker-compose ps

# Logları izle
docker-compose logs -f worker
```

### Manuel Başlatma

```bash
# API Gateway
npm start

# Worker Service (ayrı terminal)
npm run worker
```

---

## 📊 Kullanım Örnekleri

### Örnek 1: Fiyat Sorusu → AI Yanıt

**Gelen Mesaj:**
```json
{
  "platform": "whatsapp",
  "sender_id": "+905551234567",
  "text": "Fiyat bilgisi alabilir miyim?"
}
```

**Otomatik İşlem:**
1. Worker mesajı alır
2. AI intent detection: `price_inquiry` (95%)
3. Auto-reply gönderir
4. Event yayınlanır

### Örnek 2: Şikayet → Google Chat Handoff

**Gelen Mesaj:**
```json
{
  "platform": "facebook",
  "sender_id": "USER_123",
  "text": "Ürününüz bozuk!"
}
```

**Otomatik İşlem:**
1. AI: `complaint` (98%) → HANDOFF REQUIRED
2. Google Chat space oluşturulur
3. Satış temsilcisi atanır
4. Context transfer edilir
5. Müşteriye otomatik yanıt

---

## 🧪 Test

```bash
# Tüm testleri çalıştır
npm test

# Coverage ile
npm test -- --coverage

# Specifik test
npm test server.test.js
```

### Test Sonuçları
```
Test Suites: 3 total
Tests:       50 total
Pass Rate:   84% ✅
Duration:    ~3s
```

---

## 📁 Proje Yapısı

```
meta-api-gateway/
├── server.js                 # HTTP server launcher
├── app.js                    # Express application
├── worker.js                 # BullMQ worker (AI + Google Chat)
├── webhook-security.js       # Signature verification
├── ai-orchestrator.js        # AI intent detection
├── google-chat-handoff.js    # Google Chat integration
├── cloudevents.js            # CloudEvents standard
│
├── database-migrations.sql   # DB constraints + indexes
├── unified-inbox-schema.sql  # Conversations schema
│
├── server.test.js            # Core tests
├── ai-orchestrator.test.js   # AI tests
├── integration.test.js       # E2E tests
│
├── package.json
├── Dockerfile
├── docker-compose.yml
├── .env.example
├── .gitignore
└── README.md
```

---

## ⚙️ Konfigürasyon

### Environment Variables

```bash
# Meta Platform
META_WEBHOOK_VERIFY_TOKEN=your_verify_token
META_APP_SECRET=your_app_secret
META_ACCESS_TOKEN=your_access_token

# AI (OpenAI)
OPENAI_API_KEY=sk-proj-xxx

# Google Chat
GOOGLE_CHAT_WEBHOOK_URL=https://chat.googleapis.com/...
SALES_TEAM_MEMBERS={"senior":"ahmet@company.com"}

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/nitro_meta_erp
```

---

## 🔒 Güvenlik

### Webhook Signature Verification
```javascript
// Tüm Meta webhook'ları HMAC SHA256 ile doğrulanır
verifyWebhookSignature(rawBody, signature, secret);
```

### Rate Limiting
- Webhook: 1000 req/min
- WhatsApp: 100 req/min
- Auth: 10 req/min

### Data Protection
- SQL injection koruması
- Input validation
- Helmet.js security headers

---

## 📈 Monitoring

### Health Check
```bash
curl http://localhost:3000/health
```

**Response:**
```json
{
  "status": "OK",
  "redis": "connected",
  "queue": "active",
  "uptime": 12345.67
}
```

### Prometheus Metrics
```bash
curl http://localhost:3000/metrics
```

**Key Metrics:**
- `webhooks_received_total`
- `ai_intent_detection_total`
- `handoffs_initiated_total`
- `auto_replies_sent_total`

---

## 🐳 Docker Deployment

```bash
# Production build
docker-compose -f docker-compose.yml up -d

# Scale workers
docker-compose up -d --scale worker=3

# Logs
docker-compose logs -f api-gateway
docker-compose logs -f worker
```

---

## 🛠️ Troubleshooting

### Issue: AI Yanıt Göndermiyor
```bash
# Check OpenAI API key
docker exec meta-api-gateway env | grep OPENAI

# Check logs
docker-compose logs worker | grep "AI Intent"
```

### Issue: Queue Dolu
```bash
# Check queue length
docker exec meta-redis redis-cli LLEN message-processing-queue

# Clear queue
docker exec meta-redis redis-cli DEL message-processing-queue
```

### Issue: Google Chat Handoff Çalışmıyor
```bash
# Verify webhook URL
docker exec meta-worker env | grep GOOGLE_CHAT

# Check handoff worker logs
docker-compose logs worker | grep "Google Chat"
```

---

## 📝 License

MIT License - see [LICENSE](LICENSE) file for details.

---

## 👥 Contributors

- **Ibrahim Takil** - Initial work
- **Nitro Mekatronik Team**

---

## 📞 Support

- **Issues:** GitHub Issues
- **Email:** tech@nitrobilisim.com
- **Documentation:** See `/docs` folder

---

**Version:** 1.0.0  
**Status:** Production Ready ✅  
**Last Updated:** 2026-03-19
