"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendTestWebhook = sendTestWebhook;
exports.createAppointmentCreatedPayload = createAppointmentCreatedPayload;
exports.generateSignature = generateSignature;
// src/test/test-webhook.ts
const axios_1 = __importDefault(require("axios"));
const crypto_1 = __importDefault(require("crypto"));
const dotenv_1 = __importDefault(require("dotenv"));
// Load environment variables
dotenv_1.default.config();
// Configuration
const WEBHOOK_URL = process.env.WEBHOOK_URL || 'http://localhost:3001/api/webhooks/intakeq';
const WEBHOOK_SECRET = process.env.INTAKEQ_WEBHOOK_SECRET || 'test-secret';
/**
 * Generate HMAC signature for webhook payload
 */
function generateSignature(payload) {
    const hmac = crypto_1.default.createHmac('sha256', WEBHOOK_SECRET);
    const payloadStr = typeof payload === 'string' ? payload : JSON.stringify(payload);
    hmac.update(payloadStr);
    return hmac.digest('hex');
}
/**
 * Send test webhook
 */
function sendTestWebhook(payload) {
    return __awaiter(this, void 0, void 0, function* () {
        // Convert payload to JSON string
        const payloadStr = JSON.stringify(payload);
        // Generate signature
        const signature = generateSignature(payloadStr);
        console.log('Sending test webhook to:', WEBHOOK_URL);
        console.log('Payload:', payload);
        console.log('Signature:', signature);
        try {
            // Send request with signature header
            const response = yield axios_1.default.post(WEBHOOK_URL, payload, {
                headers: {
                    'Content-Type': 'application/json',
                    'X-IntakeQ-Signature': signature
                }
            });
            console.log('Response status:', response.status);
            console.log('Response data:', response.data);
            return response.data;
        }
        catch (error) {
            if (axios_1.default.isAxiosError(error) && error.response) {
                console.error('Error response:', {
                    status: error.response.status,
                    data: error.response.data
                });
            }
            else {
                console.error('Error sending webhook:', error);
            }
            throw error;
        }
    });
}
/**
 * Generate test appointment created payload
 */
function createAppointmentCreatedPayload() {
    const now = new Date();
    const startTime = new Date(now);
    startTime.setHours(startTime.getHours() + 1);
    startTime.setMinutes(0, 0, 0);
    const endTime = new Date(startTime);
    endTime.setMinutes(endTime.getMinutes() + 60);
    return {
        EventType: 'AppointmentCreated',
        ClientId: 12345,
        Appointment: {
            Id: `test-${Date.now()}`,
            ClientName: 'Test Client',
            ClientEmail: 'test@example.com',
            ClientPhone: '555-123-4567',
            ClientDateOfBirth: '1990-01-01',
            ClientId: 12345,
            Status: 'Confirmed',
            StartDate: startTime.getTime(),
            EndDate: endTime.getTime(),
            Duration: 60,
            ServiceName: 'Therapy Session',
            ServiceId: '1',
            LocationName: 'Main Office',
            LocationId: '1',
            Price: 150,
            PractitionerName: 'Dr. Therapist',
            PractitionerEmail: 'therapist@example.com',
            PractitionerId: '1',
            IntakeId: null,
            DateCreated: now.getTime(),
            CreatedBy: 'Test Script',
            BookedByClient: false,
            StartDateIso: startTime.toISOString(),
            EndDateIso: endTime.toISOString(),
            StartDateLocal: startTime.toLocaleString(),
            EndDateLocal: endTime.toLocaleString(),
            StartDateLocalFormatted: startTime.toLocaleString()
        }
    };
}
/**
 * Run the test
 */
function runTest() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            // Create test payload
            const payload = createAppointmentCreatedPayload();
            // Send test webhook
            yield sendTestWebhook(payload);
            console.log('Test completed successfully');
        }
        catch (error) {
            console.error('Test failed:', error);
            process.exit(1);
        }
    });
}
// Run test if executed directly
if (require.main === module) {
    runTest();
}
