# Nitro Meta API Gateway - Swagger Documentation

Base URL: `http://localhost:3000`

## Authentication

Most endpoints require authentication using API keys or JWT tokens.

### Headers
```
X-API-Key: your-api-key
Authorization: Bearer <jwt-token>
```

---

## Endpoints

### Health Check

#### GET `/health`

Check service health and Redis connection status.

**Response:**
```json
{
  "status": "OK",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "redis": "connected"
}
```

---

### Webhook Management

#### GET `/api/meta/webhook`

Facebook/Meta webhook verification endpoint.

**Query Parameters:**
- `hub.mode` (required): Verification mode
- `hub.verify_token` (required): Verification token
- `hub.challenge` (required): Challenge string

**Response:** 
- `200 OK`: Returns challenge string
- `403 Forbidden`: Invalid verification

---

#### POST `/api/meta/webhook`

Receive webhooks from Meta platforms (Facebook, Instagram, WhatsApp).

**Headers:**
```
X-Hub-Signature-256: sha256=<signature>
```

**Request Body:**
```json
{
  "object": "page",
  "entry": [{
    "id": "PAGE_ID",
    "time": 1234567890,
    "changes": [{
      "field": "leadgen",
      "value": {
        "ad_id": "AD_ID",
        "form_id": "FORM_ID",
        "leadgen_id": "LEAD_ID",
        "field_data": [...]
      }
    }]
  }]
}
```

**Response:**
```json
{
  "success": true,
  "message": "Event received"
}
```

**Status Codes:**
- `200 OK`: Webhook received successfully
- `403 Forbidden`: Invalid signature
- `429 Too Many Requests`: Rate limit exceeded
- `500 Internal Server Error`: Processing error

---

### WhatsApp Integration

#### POST `/api/whatsapp/send`

Send WhatsApp message via whatsapp-web.js service.

**Request Body:**
```json
{
  "userId": "USER_123",
  "number": "+905551234567",
  "message": "Hello from Nitro ERP!"
}
```

**Response:**
```json
{
  "success": true,
  "messageId": "MSG_123456",
  "status": "sent"
}
```

**Status Codes:**
- `200 OK`: Message sent
- `400 Bad Request`: Missing required fields
- `500 Internal Server Error`: Send failed

---

#### POST `/api/whatsapp/initialize`

Initialize WhatsApp client for a user.

**Request Body:**
```json
{
  "userId": "USER_123"
}
```

**Response:**
```json
{
  "success": true,
  "qrCode": "data:image/png;base64,...",
  "status": "pending_scan"
}
```

---

### Lead Management

Leads are automatically processed from Meta Lead Ads and forwarded to Nitro ERP.

**Lead Data Structure:**
```json
{
  "lead_id": "LEAD_123",
  "platform": "facebook",
  "source": "facebook_lead_ads",
  "ad_id": "AD_123",
  "form_id": "FORM_123",
  "customer_name": "John Doe",
  "email": "john@example.com",
  "phone_number": "+905551234567",
  "company": "ABC Corp",
  "city": "Istanbul",
  "country": "Turkey",
  "status": "new",
  "priority": "medium",
  "tags": ["hot_lead", "enterprise"],
  "created_at": "2024-01-15T10:30:00.000Z"
}
```

---

## Error Handling

All errors follow this format:

```json
{
  "success": false,
  "error": "Error type",
  "message": "Detailed error message",
  "code": "ERROR_CODE"
}
```

### Common Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `INVALID_SIGNATURE` | 403 | Webhook signature verification failed |
| `MISSING_FIELD` | 400 | Required field missing |
| `RATE_LIMIT_EXCEEDED` | 429 | Too many requests |
| `REDIS_ERROR` | 500 | Redis connection error |
| `ERP_UNAVAILABLE` | 503 | Nitro ERP service unavailable |

---

## Rate Limiting

- **Webhook Endpoint**: 1000 requests per 15 minutes per IP
- **WhatsApp API**: 100 requests per minute per user
- **Health Check**: No limit

**Rate Limit Headers:**
```
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 999
X-RateLimit-Reset: 1642234567
```

---

## Webhook Payload Examples

### Lead Ad Submission
```json
{
  "object": "page",
  "entry": [{
    "id": "123456789",
    "time": 1642234567,
    "changes": [{
      "field": "leadgen",
      "value": {
        "ad_id": "987654321",
        "form_id": "123456789",
        "leadgen_id": "555666777",
        "field_data": [
          {
            "name": "full_name",
            "values": ["Ahmet Yılmaz"]
          },
          {
            "name": "email",
            "values": ["ahmet@example.com"]
          },
          {
            "name": "phone_number",
            "values": ["+905551234567"]
          }
        ]
      }
    }]
  }]
}
```

### WhatsApp Message Received
```json
{
  "object": "whatsapp_business_account",
  "entry": [{
    "id": "WHATSAPP_BUSINESS_ACCOUNT_ID",
    "time": 1642234567,
    "changes": [{
      "field": "messages",
      "value": {
        "messaging_product": "whatsapp",
        "metadata": {
          "display_phone_number": "+905559876543",
          "phone_number_id": "123456789"
        },
        "contacts": [{
          "profile": {
            "name": "Ayşe Demir"
          },
          "wa_id": "905551234567"
        }],
        "messages": [{
          "from": "905551234567",
          "id": "wamid.HBgNOTE...",
          "timestamp": "1642234567",
          "type": "text",
          "text": {
            "body": "Ürün fiyatı nedir?"
          }
        }]
      }
    }]
  }]
}
```

---

## Retry Logic

Failed webhook processing follows exponential backoff:

- **Attempt 1**: Immediate
- **Attempt 2**: After 5 seconds
- **Attempt 3**: After 15 seconds
- **Attempt 4**: After 30 seconds
- **Attempt 5**: After 60 seconds

After 5 failed attempts, the webhook is moved to dead letter queue for manual review.

---

## Security Best Practices

1. **Always verify webhook signatures** in production
2. **Use HTTPS** for all communications
3. **Rotate API keys** regularly
4. **Implement rate limiting** per user/IP
5. **Log all activities** for audit trails
6. **Validate input data** before processing
7. **Use environment variables** for sensitive data

---

## Support

For technical support and API access requests:
- Email: tech@nitrobilisim.com.tr
- Documentation: https://docs.nitrobilisim.com.tr
