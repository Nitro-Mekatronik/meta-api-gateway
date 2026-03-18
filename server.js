// Simple server launcher - app logic is in app.js
const app = require('./app');

const PORT = process.env.PORT || 3000;

// Start the server (only if not in test mode)
if (process.env.NODE_ENV !== 'test') {
    app.listen(PORT, () => {
        console.log(`🚀 API Gateway listening on port ${PORT}`);
        console.log(`📊 Health check: http://localhost:${PORT}/health`);
    });
}
