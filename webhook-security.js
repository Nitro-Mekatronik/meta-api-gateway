const crypto = require('crypto');

/**
 * Verify Meta webhook signature
 * @param {Buffer|string} rawBody - Raw request body
 * @param {string|null} signature - X-Hub-Signature-256 header value
 * @param {string} secret - App secret key
 * @returns {boolean} - True if signature is valid
 */
function verifyWebhookSignature(rawBody, signature, secret) {
    if (!signature || !secret) {
        return false;
    }

    const [algorithm, hash] = signature.split('=');

    if (algorithm !== 'sha256') {
        return false;
    }

    const bodyBuffer = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody);
    const expectedHash = crypto
        .createHmac('sha256', secret)
        .update(bodyBuffer)
        .digest('hex');

    try {
        return crypto.timingSafeEqual(
            Buffer.from(hash, 'hex'),
            Buffer.from(expectedHash, 'hex')
        );
    } catch (err) {
        return false;
    }
}

module.exports = { verifyWebhookSignature };
