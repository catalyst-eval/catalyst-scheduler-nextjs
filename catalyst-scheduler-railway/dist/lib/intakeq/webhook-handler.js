"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebhookHandler = void 0;
class WebhookHandler {
    constructor(sheetsService) {
        this.sheetsService = sheetsService;
        this.MAX_RETRIES = 3;
        this.RETRY_DELAYS = [1000, 5000, 15000]; // Delays in milliseconds
    }
    /**
     * Get event type from payload, handling both field names
     */
    getEventType(payload) {
        // Use EventType if available, fall back to Type
        return payload.EventType || payload.Type;
    }
    /**
     * Process incoming webhook with validation and retries
     */
    async processWebhook(payload, signature) {
        try {
            // Validate webhook payload
            const validationResult = this.validateWebhook(payload);
            if (!validationResult.isValid) {
                await this.logWebhookError('VALIDATION_ERROR', validationResult.error || 'Unknown validation error', payload);
                return {
                    success: false,
                    error: validationResult.error,
                    retryable: false
                };
            }
            const typedPayload = payload;
            // Log webhook receipt
            await this.sheetsService.addAuditLog({
                timestamp: new Date().toISOString(),
                eventType: 'WEBHOOK_RECEIVED',
                description: `Received ${this.getEventType(typedPayload)} webhook`,
                user: 'INTAKEQ_WEBHOOK',
                systemNotes: JSON.stringify({
                    type: this.getEventType(typedPayload),
                    clientId: typedPayload.ClientId
                })
            });
            // Process with retry logic
            return await this.processWithRetry(typedPayload);
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            await this.logWebhookError('PROCESSING_ERROR', errorMessage, payload);
            return {
                success: false,
                error: errorMessage,
                retryable: this.isRetryableError(error)
            };
        }
    }
    /**
     * Validate webhook payload and signature
     */
    validateWebhook(payload) {
        // Basic payload validation
        if (!payload || typeof payload !== 'object') {
            return { isValid: false, error: 'Invalid payload format' };
        }
        const typedPayload = payload;
        // Required fields validation - check both Type and EventType
        const eventType = this.getEventType(typedPayload);
        if (!eventType) {
            return { isValid: false, error: 'Missing event type field' };
        }
        if (!typedPayload.ClientId) {
            return { isValid: false, error: 'Missing ClientId field' };
        }
        // Type-specific validation for non-appointment events (appointment events are handled by AppointmentSyncHandler)
        if (!eventType.includes('Appointment') && !eventType.includes('appointment')) {
            // For form submissions
            if (eventType.includes('Form') || eventType.includes('Intake')) {
                if (!typedPayload.responses) {
                    return { isValid: false, error: 'Missing form responses' };
                }
            }
        }
        return { isValid: true };
    }
    /**
     * Process webhook with retry logic
     */
    async processWithRetry(payload, attempt = 0) {
        try {
            let result;
            const eventType = this.getEventType(payload);
            console.log('Processing event type:', eventType);
            if (!eventType) {
                return {
                    success: false,
                    error: 'Missing event type',
                    retryable: false
                };
            }
            // Handle non-appointment events (appointment events should be handled by AppointmentSyncHandler)
            if (eventType.includes('Form Submitted') || eventType.includes('Intake Submitted')) {
                result = await this.handleIntakeSubmission(payload);
            }
            else if (!eventType.includes('Appointment') && !eventType.includes('appointment')) {
                console.log('Unhandled event type:', {
                    receivedType: eventType,
                    payloadType: payload.Type,
                    expectedTypes: [
                        'Form Submitted',
                        'Intake Submitted'
                    ]
                });
                return {
                    success: false,
                    error: `Unsupported webhook type: ${eventType}`,
                    retryable: false
                };
            }
            else {
                // Return a message indicating this should be handled by AppointmentSyncHandler
                return {
                    success: false,
                    error: 'Appointment events should be handled by AppointmentSyncHandler',
                    retryable: false
                };
            }
            if (!result.success && result.retryable && attempt < this.MAX_RETRIES) {
                // Log retry attempt
                await this.sheetsService.addAuditLog({
                    timestamp: new Date().toISOString(),
                    eventType: 'WEBHOOK_RECEIVED',
                    description: `Retry attempt ${attempt + 1} for ${eventType}`,
                    user: 'SYSTEM',
                    systemNotes: JSON.stringify({
                        attempt: attempt + 1,
                        type: eventType,
                        clientId: payload.ClientId
                    })
                });
                // Wait for delay
                await new Promise(resolve => setTimeout(resolve, this.RETRY_DELAYS[attempt]));
                // Retry processing
                return this.processWithRetry(payload, attempt + 1);
            }
            return result;
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            // Log error
            await this.logWebhookError('RETRY_ERROR', `Error on attempt ${attempt + 1}: ${errorMessage}`, payload);
            // Determine if another retry should be attempted
            if (this.isRetryableError(error) && attempt < this.MAX_RETRIES) {
                await new Promise(resolve => setTimeout(resolve, this.RETRY_DELAYS[attempt]));
                return this.processWithRetry(payload, attempt + 1);
            }
            return {
                success: false,
                error: errorMessage,
                retryable: false
            };
        }
    }
    /**
     * Handle intake form submission
     */
    async handleIntakeSubmission(payload) {
        try {
            // Log initial receipt of form
            await this.sheetsService.addAuditLog({
                timestamp: new Date().toISOString(),
                eventType: 'WEBHOOK_RECEIVED',
                description: `Processing intake form ${payload.formId}`,
                user: 'INTAKEQ_WEBHOOK',
                systemNotes: JSON.stringify({
                    formId: payload.formId,
                    clientId: payload.ClientId,
                    isFullIntake: !!payload.IntakeId
                })
            });
            // Ensure we have responses to process
            if (!payload.responses) {
                return {
                    success: false,
                    error: 'No form responses provided',
                    retryable: false
                };
            }
            // Process responses based on form type
            const formResponses = payload.IntakeId ?
                this.extractAccessibilitySection(payload.responses) :
                payload.responses;
            // Validate processed responses
            if (Object.keys(formResponses).length === 0) {
                return {
                    success: false,
                    error: 'No valid accessibility responses found',
                    retryable: false
                };
            }
            // Process form data
            await this.sheetsService.processAccessibilityForm({
                clientId: payload.ClientId.toString(),
                clientName: payload.ClientName || 'Unknown Client',
                clientEmail: payload.ClientEmail || 'unknown@example.com',
                formResponses: formResponses
            });
            // Return success response
            return {
                success: true,
                details: {
                    formId: payload.formId,
                    clientId: payload.ClientId,
                    type: payload.IntakeId ? 'full-intake' : 'accessibility-form',
                    source: payload.IntakeId ? 'embedded' : 'standalone'
                }
            };
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            await this.logWebhookError('FORM_PROCESSING_ERROR', errorMessage, payload);
            return {
                success: false,
                error: errorMessage,
                retryable: this.isRetryableError(error)
            };
        }
    }
    /**
     * Determine if an error is retryable
     */
    isRetryableError(error) {
        if (error instanceof Error) {
            // Network errors are typically retryable
            if (error.message.includes('network') || error.message.includes('timeout')) {
                return true;
            }
            // API rate limiting errors are retryable
            if (error.message.includes('rate limit') || error.message.includes('429')) {
                return true;
            }
            // Temporary service errors are retryable
            if (error.message.includes('503') || error.message.includes('temporary')) {
                return true;
            }
        }
        return false;
    }
    /**
     * Log webhook error
     */
    async logWebhookError(errorType, message, payload) {
        await this.sheetsService.addAuditLog({
            timestamp: new Date().toISOString(),
            eventType: 'SYSTEM_ERROR',
            description: `Webhook ${errorType}: ${message}`,
            user: 'SYSTEM',
            systemNotes: JSON.stringify({
                errorType,
                payload,
                timestamp: new Date().toISOString()
            })
        });
    }
    /**
     * Extract accessibility section from responses
     */
    extractAccessibilitySection(responses) {
        // Map the accessibility questions from the full intake form
        const accessibilityResponses = {};
        // Define accessibility question mappings
        const questionMappings = {
            'Do you use any mobility devices?': 'mobility_devices',
            'Access needs related to mobility/disability (Please specify)': 'mobility_other',
            'Do you experience sensory sensitivities?': 'sensory_sensitivities',
            'Other (Please specify):': 'sensory_other',
            'Do you experience challenges with physical environment?': 'physical_environment',
            'Please indicate your comfort level with this possibility:': 'room_consistency',
            'Do you have support needs that involve any of the following?': 'support_needs',
            'Is there anything else we should know about your space or accessibility needs?': 'additional_notes'
        };
        // Extract relevant responses
        for (const [question, key] of Object.entries(questionMappings)) {
            if (responses[question] !== undefined) {
                accessibilityResponses[question] = responses[question];
            }
        }
        console.log('Extracted accessibility responses:', accessibilityResponses);
        return accessibilityResponses;
    }
}
exports.WebhookHandler = WebhookHandler;
exports.default = WebhookHandler;
