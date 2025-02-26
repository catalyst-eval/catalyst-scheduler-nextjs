"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// This must be the very first import
const dotenv_1 = __importDefault(require("dotenv"));
// Load environment variables immediately
dotenv_1.default.config();
// Add environment debugging
console.log('Environment variables:');
console.log('NODE_ENV:', process.env.NODE_ENV || 'not set');
console.log('GOOGLE_SHEETS_PRIVATE_KEY exists:', !!process.env.GOOGLE_SHEETS_PRIVATE_KEY);
console.log('GOOGLE_SHEETS_CLIENT_EMAIL exists:', !!process.env.GOOGLE_SHEETS_CLIENT_EMAIL);
console.log('GOOGLE_SHEETS_SPREADSHEET_ID exists:', !!process.env.GOOGLE_SHEETS_SPREADSHEET_ID);
console.log('INTAKEQ_API_KEY exists:', !!process.env.INTAKEQ_API_KEY);
const express_1 = __importDefault(require("express"));
const test_1 = __importDefault(require("./routes/test"));
const webhooks_1 = __importDefault(require("./routes/webhooks"));
const verify_signature_1 = require("./middleware/verify-signature");
const app = (0, express_1.default)();
// Special handling for IntakeQ webhook path - we need to capture the raw body
app.use('/api/webhooks/intakeq', verify_signature_1.captureRawBody);
// Regular JSON parsing for all other routes
app.use(express_1.default.json());
// Routes
app.use('/api/test', test_1.default);
app.use('/api/webhooks', webhooks_1.default);
// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV,
        env_vars_loaded: {
            GOOGLE_SHEETS_CLIENT_EMAIL: !!process.env.GOOGLE_SHEETS_CLIENT_EMAIL,
            GOOGLE_SHEETS_SPREADSHEET_ID: !!process.env.GOOGLE_SHEETS_SPREADSHEET_ID,
            GOOGLE_SHEETS_PRIVATE_KEY: !!process.env.GOOGLE_SHEETS_PRIVATE_KEY,
            INTAKEQ_API_KEY: !!process.env.INTAKEQ_API_KEY
        }
    });
});
// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({
        success: false,
        error: 'Internal Server Error',
        timestamp: new Date().toISOString()
    });
});
// Handle 404s
app.use((req, res) => {
    res.status(404).json({
        success: false,
        error: 'Not Found',
        path: req.path,
        method: req.method,
        timestamp: new Date().toISOString()
    });
});
const port = process.env.PORT || 3001;
if (require.main === module) {
    app.listen(port, () => {
        console.log(`Server running on port ${port}`);
        console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
        console.log(`Webhook endpoint available at: http://localhost:${port}/api/webhooks/intakeq`);
    });
}
exports.default = app;
