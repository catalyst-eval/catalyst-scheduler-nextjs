"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.IntakeQService = void 0;
// src/lib/intakeq/service.ts
const axios_1 = __importDefault(require("axios"));
const crypto_1 = __importDefault(require("crypto"));
const sheets_1 = require("../google/sheets");
const office_id_1 = require("../util/office-id");
class IntakeQService {
    constructor(sheetsService, baseUrl = 'https://intakeq.com/api/v1', useMockData = false) {
        this.useMockData = useMockData;
        this.MAX_RETRIES = 3;
        this.RETRY_DELAY = 1000; // 1 second base delay
        if (!process.env.INTAKEQ_API_KEY) {
            throw new Error('Missing INTAKEQ_API_KEY environment variable');
        }
        this.apiKey = process.env.INTAKEQ_API_KEY;
        this.baseUrl = baseUrl;
        this.sheetsService = sheetsService;
    }
    /**
     * Get appointments from IntakeQ API
     */
    async getAppointments(startDate, endDate, status = 'Confirmed,WaitingConfirmation,Pending') {
        try {
            console.log('Fetching IntakeQ appointments:', { startDate, endDate });
            // Convert dates to EST and set proper day boundaries
            const requestedStart = new Date(startDate);
            const requestedEnd = new Date(endDate);
            // Ensure we're working with EST dates
            const startEST = new Date(requestedStart.toLocaleString('en-US', { timeZone: 'America/New_York' }));
            const endEST = new Date(requestedEnd.toLocaleString('en-US', { timeZone: 'America/New_York' }));
            startEST.setHours(0, 0, 0, 0);
            endEST.setHours(23, 59, 59, 999);
            console.log('Date ranges (EST):', {
                start: startEST.toISOString(),
                end: endEST.toISOString()
            });
            const params = new URLSearchParams({
                StartDate: startEST.toISOString(),
                EndDate: endEST.toISOString(),
                Status: status,
                dateField: 'StartDateIso'
            });
            const url = `${this.baseUrl}/appointments?${params}`;
            console.log('IntakeQ Request:', {
                endpoint: '/appointments',
                params: Object.fromEntries(params),
                requestRange: {
                    start: startEST.toISOString(),
                    end: endEST.toISOString()
                }
            });
            let attempt = 0;
            let response;
            let lastError;
            while (attempt < this.MAX_RETRIES) {
                try {
                    response = await axios_1.default.get(url, {
                        headers: {
                            'X-Auth-Key': this.apiKey,
                            'Accept': 'application/json'
                        }
                    });
                    if (response.status === 200)
                        break;
                    const errorText = await response.statusText;
                    lastError = `HTTP ${response.status}: ${errorText}`;
                    console.log(`Attempt ${attempt + 1} failed:`, {
                        status: response.status,
                        error: lastError,
                        headers: response.headers,
                        url: url
                    });
                    attempt++;
                    if (attempt < this.MAX_RETRIES) {
                        const delay = this.RETRY_DELAY * Math.pow(2, attempt - 1);
                        await new Promise(resolve => setTimeout(resolve, delay));
                    }
                }
                catch (error) {
                    lastError = error instanceof Error ? error.message : 'Unknown error';
                    console.log(`Attempt ${attempt + 1} error:`, {
                        error: lastError,
                        url: url
                    });
                    attempt++;
                    if (attempt < this.MAX_RETRIES) {
                        const delay = this.RETRY_DELAY * Math.pow(2, attempt - 1);
                        await new Promise(resolve => setTimeout(resolve, delay));
                    }
                }
            }
            if (!response || response.status !== 200) {
                const errorMessage = `IntakeQ API error after ${this.MAX_RETRIES} attempts: ${lastError}`;
                console.error('Final error details:', {
                    attempts: attempt,
                    lastError,
                    requestUrl: url
                });
                throw new Error(errorMessage);
            }
            const appointments = response.data;
            // Filter appointments to match requested date in EST
            const filteredAppointments = appointments.filter((appt) => {
                const apptDate = new Date(appt.StartDateIso);
                const apptEST = new Date(apptDate.toLocaleString('en-US', { timeZone: 'America/New_York' }));
                apptEST.setHours(0, 0, 0, 0); // Compare dates only
                const targetEST = new Date(requestedStart.toLocaleString('en-US', { timeZone: 'America/New_York' }));
                targetEST.setHours(0, 0, 0, 0); // Compare dates only
                console.log('Appointment comparison:', {
                    id: appt.Id,
                    client: appt.ClientName,
                    apptDate: apptEST.toISOString(),
                    targetDate: targetEST.toISOString(),
                    matches: apptEST.getTime() === targetEST.getTime()
                });
                return apptEST.getTime() === targetEST.getTime();
            });
            console.log('IntakeQ Response:', {
                status: response.status,
                totalReturned: appointments.length,
                matchingDateRange: filteredAppointments.length,
                sampleAppointment: filteredAppointments[0] ? {
                    id: filteredAppointments[0].Id,
                    name: filteredAppointments[0].ClientName,
                    date: filteredAppointments[0].StartDateLocalFormatted,
                    status: filteredAppointments[0].Status
                } : null
            });
            return filteredAppointments;
        }
        catch (error) {
            console.error('IntakeQ API Error:', error instanceof Error ? error.message : 'Unknown error');
            await this.sheetsService.addAuditLog({
                timestamp: new Date().toISOString(),
                eventType: sheets_1.AuditEventType.SYSTEM_ERROR,
                description: 'IntakeQ API error',
                user: 'SYSTEM',
                systemNotes: error instanceof Error ? error.message : 'Unknown error'
            });
            throw error;
        }
    }
    /**
     * Get a single appointment from IntakeQ API
     */
    async getAppointment(appointmentId) {
        try {
            console.log(`Fetching IntakeQ appointment: ${appointmentId}`);
            const response = await axios_1.default.get(`${this.baseUrl}/appointments/${appointmentId}`, {
                headers: {
                    'X-Auth-Key': this.apiKey,
                    'Accept': 'application/json'
                }
            });
            if (response.status !== 200 || !response.data) {
                throw new Error(`IntakeQ API error: ${response.statusText}`);
            }
            console.log(`Successfully fetched appointment ${appointmentId}`);
            return response.data;
        }
        catch (error) {
            console.error(`Error fetching appointment ${appointmentId} from IntakeQ:`, error);
            // If we get a 404, return null instead of throwing
            if (axios_1.default.isAxiosError(error) && error.response?.status === 404) {
                console.log(`Appointment ${appointmentId} not found`);
                return null;
            }
            await this.sheetsService.addAuditLog({
                timestamp: new Date().toISOString(),
                eventType: sheets_1.AuditEventType.SYSTEM_ERROR,
                description: `Error fetching appointment ${appointmentId} from IntakeQ`,
                user: 'SYSTEM',
                systemNotes: error instanceof Error ? error.message : 'Unknown error'
            });
            throw error;
        }
    }
    /**
     * Get practitioner information from IntakeQ API
     */
    async getPractitioners() {
        try {
            console.log('Fetching IntakeQ practitioners');
            const response = await axios_1.default.get(`${this.baseUrl}/practitioners`, {
                headers: {
                    'X-Auth-Key': this.apiKey,
                    'Accept': 'application/json'
                }
            });
            if (response.status !== 200 || !response.data) {
                throw new Error(`IntakeQ API error: ${response.statusText}`);
            }
            console.log(`Successfully fetched ${response.data.length} practitioners`);
            return response.data;
        }
        catch (error) {
            console.error('Error fetching practitioners from IntakeQ:', error);
            await this.sheetsService.addAuditLog({
                timestamp: new Date().toISOString(),
                eventType: sheets_1.AuditEventType.SYSTEM_ERROR,
                description: 'Error fetching practitioners from IntakeQ',
                user: 'SYSTEM',
                systemNotes: error instanceof Error ? error.message : 'Unknown error'
            });
            throw error;
        }
    }
    /**
     * Get client information from IntakeQ API
     */
    async getClient(clientId) {
        try {
            console.log(`Fetching IntakeQ client: ${clientId}`);
            const response = await axios_1.default.get(`${this.baseUrl}/clients/${clientId}`, {
                headers: {
                    'X-Auth-Key': this.apiKey,
                    'Accept': 'application/json'
                }
            });
            if (response.status !== 200 || !response.data) {
                throw new Error(`IntakeQ API error: ${response.statusText}`);
            }
            console.log(`Successfully fetched client ${clientId}`);
            return response.data;
        }
        catch (error) {
            console.error(`Error fetching client ${clientId} from IntakeQ:`, error);
            // If we get a 404, return null instead of throwing
            if (axios_1.default.isAxiosError(error) && error.response?.status === 404) {
                console.log(`Client ${clientId} not found`);
                return null;
            }
            await this.sheetsService.addAuditLog({
                timestamp: new Date().toISOString(),
                eventType: sheets_1.AuditEventType.SYSTEM_ERROR,
                description: `Error fetching client ${clientId} from IntakeQ`,
                user: 'SYSTEM',
                systemNotes: error instanceof Error ? error.message : 'Unknown error'
            });
            throw error;
        }
    }
    /**
     * Validate IntakeQ webhook signature
     */
    async validateWebhookSignature(payload, signature) {
        try {
            const secret = process.env.INTAKEQ_WEBHOOK_SECRET;
            if (!secret) {
                console.error('Missing INTAKEQ_WEBHOOK_SECRET environment variable');
                return false;
            }
            // Remove any quotes from the secret
            const cleanSecret = secret.replace(/['"]/g, '');
            // Create HMAC
            const hmac = crypto_1.default.createHmac('sha256', cleanSecret);
            hmac.update(payload);
            const calculatedSignature = hmac.digest('hex');
            console.log('Webhook Signature Validation:', {
                signatureMatches: calculatedSignature === signature,
                calculatedLength: calculatedSignature.length,
                providedLength: signature.length,
                payloadLength: payload.length,
            });
            return calculatedSignature === signature;
        }
        catch (error) {
            console.error('Webhook signature validation error:', error);
            return false;
        }
    }
    /**
     * Test connection to IntakeQ API
     */
    async testConnection() {
        try {
            const response = await axios_1.default.get(`${this.baseUrl}/practitioners`, {
                headers: {
                    'X-Auth-Key': this.apiKey,
                    'Accept': 'application/json'
                }
            });
            console.log('IntakeQ Connection Test:', {
                status: response.status,
                ok: response.status === 200
            });
            return response.status === 200;
        }
        catch (error) {
            console.error('IntakeQ connection test failed:', error instanceof Error ? error.message : 'Unknown error');
            return false;
        }
    }
    /**
     * Determine the standardized office ID for an appointment
     */
    async getStandardizedOfficeId(appointment) {
        try {
            // If appointment already has an office assignment from our system, use that
            if (appointment.Location) {
                return (0, office_id_1.standardizeOfficeId)(appointment.Location);
            }
            // Get clinician's default office
            const clinicians = await this.sheetsService.getClinicians();
            const clinician = clinicians.find(c => c.intakeQPractitionerId === appointment.PractitionerId);
            if (clinician?.preferredOffices?.length) {
                return (0, office_id_1.standardizeOfficeId)(clinician.preferredOffices[0]);
            }
            // Default to A-a if no other assignment possible
            return (0, office_id_1.standardizeOfficeId)('A-a');
        }
        catch (error) {
            console.error('Error standardizing office ID:', error);
            return (0, office_id_1.standardizeOfficeId)('A-a');
        }
    }
    /**
     * Validate office ID format
     */
    isValidOfficeId(officeId) {
        return /^[A-Z]-[a-z]$/.test(officeId);
    }
}
exports.IntakeQService = IntakeQService;
exports.default = IntakeQService;
