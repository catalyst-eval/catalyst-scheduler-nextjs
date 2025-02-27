"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// src/routes/webhooks.ts
const express_1 = __importDefault(require("express"));
const verify_signature_1 = require("../middleware/verify-signature");
const webhook_handler_1 = require("../lib/intakeq/webhook-handler");
const appointment_sync_1 = require("../lib/intakeq/appointment-sync");
const sheets_1 = __importDefault(require("../lib/google/sheets"));
// Create router
const router = express_1.default.Router();
// Initialize services
const sheetsService = new sheets_1.default();
const appointmentSyncHandler = new appointment_sync_1.AppointmentSyncHandler(sheetsService);
const webhookHandler = new webhook_handler_1.WebhookHandler(sheetsService);
// Apply basic validation middleware to the IntakeQ route
router.use('/intakeq', (req, res, next) => {
    (0, verify_signature_1.validateIntakeQWebhook)(req, res, next);
});
// Define route handlers separately to avoid TypeScript issues
const handleWebhook = async (req, res) => {
    const startTime = Date.now();
    console.log(`[${new Date().toISOString()}] Starting webhook processing`);
    try {
        const payload = req.body;
        console.log('Received webhook:', {
            type: payload.EventType || payload.Type,
            clientId: payload.ClientId,
            appointmentId: payload.Appointment?.Id,
            timestamp: new Date().toISOString()
        });
        // Check if it's an appointment event
        const eventType = payload.EventType || payload.Type;
        const isAppointmentEvent = eventType && (eventType.includes('Appointment') || eventType.includes('appointment'));
        // Use appropriate handler
        const processPromise = isAppointmentEvent
            ? appointmentSyncHandler.processAppointmentEvent(payload)
            : webhookHandler.processWebhook(payload);
        const result = await processPromise;
        const processingTime = Date.now() - startTime;
        console.log('Webhook event processed:', {
            ...result,
            processingTime: `${processingTime}ms`
        });
        // Return appropriate response
        if (!result.success) {
            res.status(400).json({
                success: false,
                error: result.error,
                details: result.details,
                processingTime,
                timestamp: new Date().toISOString()
            });
        }
        else {
            res.json({
                success: true,
                data: result.details,
                processingTime,
                timestamp: new Date().toISOString()
            });
        }
    }
    catch (error) {
        const processingTime = Date.now() - startTime;
        console.error('Webhook processing error:', {
            error,
            processingTime: `${processingTime}ms`
        });
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error occurred',
            processingTime,
            timestamp: new Date().toISOString()
        });
    }
};
const handleTestWebhook = async (req, res) => {
    try {
        const payload = req.body;
        console.log('Received test webhook:', payload);
        if (!payload || !payload.ClientId) {
            res.status(400).json({
                success: false,
                error: 'Invalid payload format. Must include ClientId field.'
            });
            return;
        }
        // Process without signature verification
        const eventType = payload.EventType || payload.Type;
        const isAppointmentEvent = eventType && (eventType.includes('Appointment') || eventType.includes('appointment'));
        // Use appropriate handler
        const processPromise = isAppointmentEvent
            ? appointmentSyncHandler.processAppointmentEvent(payload)
            : webhookHandler.processWebhook(payload);
        try {
            const result = await processPromise;
            res.json({
                success: result.success,
                data: result.details,
                error: result.error,
                timestamp: new Date().toISOString()
            });
        }
        catch (error) {
            res.status(500).json({
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
                timestamp: new Date().toISOString()
            });
        }
    }
    catch (error) {
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
            timestamp: new Date().toISOString()
        });
    }
};
const getRecentWebhooks = async (req, res) => {
    try {
        const limit = req.query.limit ? parseInt(req.query.limit) : 10;
        const logs = await sheetsService.getRecentAuditLogs(limit);
        const webhookLogs = logs.filter(log => log.eventType === 'WEBHOOK_RECEIVED' ||
            log.eventType.includes('APPOINTMENT_'));
        res.json({
            success: true,
            data: webhookLogs,
            timestamp: new Date().toISOString()
        });
    }
    catch (error) {
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
            timestamp: new Date().toISOString()
        });
    }
};
const getHealth = (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        message: 'Webhook service is running correctly',
        webhooks: {
            intakeq: {
                enabled: true,
                config: {
                    apiKeyConfigured: !!process.env.INTAKEQ_API_KEY
                }
            }
        },
        environment: process.env.NODE_ENV
    });
};
// Apply routes
router.post('/intakeq', handleWebhook);
router.post('/test-webhook', handleTestWebhook);
router.get('/recent', getRecentWebhooks);
router.get('/health', getHealth);
exports.default = router;
