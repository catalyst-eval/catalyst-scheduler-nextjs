// src/lib/intakeq/webhook-handler.ts

import type { IntakeQWebhookPayload, WebhookEventType } from '@/types/webhooks';
import type { GoogleSheetsService } from '@/lib/google/sheets';
import { AppointmentSyncHandler } from './appointment-sync';
import { AuditEventType } from '@/lib/google/sheets';

interface WebhookProcessingResult {
  success: boolean;
  error?: string;
  retryable?: boolean;
  details?: any;
}

export class EnhancedWebhookHandler {
  private readonly MAX_RETRIES = 3;
  private readonly RETRY_DELAYS = [1000, 5000, 15000]; // Delays in milliseconds

  constructor(
    private readonly sheetsService: GoogleSheetsService,
    private readonly appointmentSync: AppointmentSyncHandler
  ) {}

  /**
   * Get event type from payload, handling both field names
   */
  private getEventType(payload: Partial<IntakeQWebhookPayload>): WebhookEventType | undefined {
    // Use EventType if available, fall back to Type
    return payload.EventType || payload.Type;
  }

  /**
   * Process incoming webhook with validation and retries
   */
  async processWebhook(
    payload: unknown,
    signature?: string
  ): Promise<WebhookProcessingResult> {
    try {
      // Validate webhook payload
      const validationResult = this.validateWebhook(payload, signature);
      if (!validationResult.isValid) {
        await this.logWebhookError('VALIDATION_ERROR', validationResult.error || 'Unknown validation error', payload);
        return {
          success: false,
          error: validationResult.error,
          retryable: false
        };
      }

      const typedPayload = payload as IntakeQWebhookPayload;

      // Log webhook receipt
      await this.sheetsService.addAuditLog({
        timestamp: new Date().toISOString(),
        eventType: AuditEventType.WEBHOOK_RECEIVED,
        description: `Received ${typedPayload.Type} webhook`,
        user: 'INTAKEQ_WEBHOOK',
        systemNotes: JSON.stringify({
          type: typedPayload.Type,
          clientId: typedPayload.ClientId
        })
      });

      // Process with retry logic
      return await this.processWithRetry(typedPayload);
    } catch (error) {
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
  private validateWebhook(
    payload: unknown,
    signature?: string
  ): { isValid: boolean; error?: string } {
    // Basic payload validation
    if (!payload || typeof payload !== 'object') {
      return { isValid: false, error: 'Invalid payload format' };
    }

    const typedPayload = payload as Partial<IntakeQWebhookPayload>;

    // Required fields validation - check both Type and EventType
    const eventType = this.getEventType(typedPayload);
    if (!typedPayload.Type && !typedPayload.EventType) {
      return { isValid: false, error: 'Missing event type field' };
    }
    if (!typedPayload.ClientId) {
      return { isValid: false, error: 'Missing ClientId field' };
    }

    // Type-specific validation
    if (typedPayload.Type === 'Appointment Created' || 
        typedPayload.Type === 'Appointment Updated') {
      if (!typedPayload.Appointment) {
        return { isValid: false, error: 'Missing appointment data' };
      }

      // Validate appointment fields
      const appointment = typedPayload.Appointment;
      if (!appointment.Id || !appointment.StartDateIso || !appointment.EndDateIso) {
        return { isValid: false, error: 'Invalid appointment data' };
      }
    }

    // Signature validation if provided
    if (signature && !this.validateSignature(payload, signature)) {
      return { isValid: false, error: 'Invalid signature' };
    }

    return { isValid: true };
  }

  /**
   * Process webhook with retry logic
   */
  private async processWithRetry(
    payload: IntakeQWebhookPayload,
    attempt: number = 0
  ): Promise<WebhookProcessingResult> {
    try {
      let result: WebhookProcessingResult;
  
      const eventType = this.getEventType(payload);
      console.log('Processing event type:', eventType);

      switch (eventType) {
        case 'Appointment Created':
        case 'Appointment Updated':
        case 'AppointmentCreated':
        case 'AppointmentUpdated':
          result = await this.appointmentSync.processAppointmentEvent(payload);
          break;

        case 'Form Submitted':
        case 'Intake Submitted':
          result = await this.handleIntakeSubmission(payload);
          break;

        default:
          console.log('Unhandled event type:', {
            receivedType: eventType,
            payloadType: payload.Type,
            expectedTypes: [
              'Appointment Created',
              'Appointment Updated',
              'Form Submitted',
              'Intake Submitted'
            ]
          });
          return {
            success: false,
            error: `Unsupported webhook type: ${payload.Type}`,
            retryable: false
          };
      }

      if (!result.success && result.retryable && attempt < this.MAX_RETRIES) {
        // Log retry attempt
        await this.sheetsService.addAuditLog({
          timestamp: new Date().toISOString(),
          eventType: AuditEventType.WEBHOOK_RECEIVED,
          description: `Retry attempt ${attempt + 1} for ${payload.Type}`,
          user: 'SYSTEM',
          systemNotes: JSON.stringify({
            attempt: attempt + 1,
            type: payload.Type,
            clientId: payload.ClientId
          })
        });
        
        // Wait for delay
        await new Promise(resolve => setTimeout(resolve, this.RETRY_DELAYS[attempt]));
        
        // Retry processing
        return this.processWithRetry(payload, attempt + 1);
      }

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      // Log error
      await this.logWebhookError(
        'RETRY_ERROR',
        `Error on attempt ${attempt + 1}: ${errorMessage}`,
        payload
      );

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
  private async handleIntakeSubmission(
    payload: IntakeQWebhookPayload
  ): Promise<WebhookProcessingResult> {
    try {
      // Log initial receipt of form
      await this.sheetsService.addAuditLog({
        timestamp: new Date().toISOString(),
        eventType: AuditEventType.WEBHOOK_RECEIVED,
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
      const formResponses: Record<string, any> = payload.IntakeId ? 
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
        clientName: payload.ClientName,
        clientEmail: payload.ClientEmail,
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
  
    } catch (error) {
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
  private isRetryableError(error: unknown): boolean {
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
   * Validate webhook signature
   */
  private validateSignature(payload: unknown, signature: string): boolean {
    // Implement signature validation logic here
    // This would typically involve HMAC verification
    return true; // Placeholder
  }

  /**
   * Log webhook error
   */
  private async logWebhookError(
    errorType: string,
    message: string,
    payload: unknown
  ): Promise<void> {
    await this.sheetsService.addAuditLog({
      timestamp: new Date().toISOString(),
      eventType: AuditEventType.SYSTEM_ERROR,
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
   * Log retry attempt
   */
  private extractAccessibilitySection(responses: Record<string, any>): Record<string, any> {
    // Map the accessibility questions from the full intake form
    const accessibilityResponses: Record<string, any> = {};
    
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