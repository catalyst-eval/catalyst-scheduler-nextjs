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
  private getEventType(payload: IntakeQWebhookPayload): WebhookEventType {
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
      switch (eventType) {
        case 'Appointment Created':
        case 'Appointment Updated':
          result = await this.appointmentSync.processAppointmentEvent(payload);
          break;

        case 'Intake Submitted':
          // Handle intake form submission
          result = await this.handleIntakeSubmission(payload);
          break;

        default:
          return {
            success: false,
            error: `Unsupported webhook type: ${payload.Type}`,
            retryable: false
          };
      }

      if (!result.success && result.retryable && attempt < this.MAX_RETRIES) {
        // Log retry attempt
        await this.logRetryAttempt(payload, attempt);
        
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
      // Process form responses
      if (!payload.formId || !payload.responses) {
        return {
          success: false,
          error: 'Missing form data',
          retryable: false
        };
      }

      // Log form submission
      await this.sheetsService.addAuditLog({
        timestamp: new Date().toISOString(),
        eventType: AuditEventType.WEBHOOK_RECEIVED,
        description: `Processing intake form ${payload.formId}`,
        user: 'INTAKEQ_WEBHOOK',
        systemNotes: JSON.stringify({
          formId: payload.formId,
          clientId: payload.ClientId
        })
      });

      // Process form data
      // Additional form processing logic would go here

      return {
        success: true,
        details: {
          formId: payload.formId,
          clientId: payload.ClientId
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
  private async logRetryAttempt(
    payload: IntakeQWebhookPayload,
    attempt: number
  ): Promise<void> {
    await this.sheetsService.addAuditLog({
      timestamp: new Date().toISOString(),
      eventType: AuditEventType.WEBHOOK_RECEIVED,
      description: `Retry attempt ${attempt + 1} for ${payload.Type}`,
      user: 'SYSTEM',
      systemNotes: JSON.stringify({
        attempt: attempt + 1,
        type: payload.Type,
        clientId: payload.ClientId,
        timestamp: new Date().toISOString()
      })
    });
  }
}