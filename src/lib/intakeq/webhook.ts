// src/lib/intakeq/webhook.ts

import type { AuditLogEntry } from '@/types/sheets';
import type { 
  IntakeQWebhookPayload, 
  WebhookEventType,
  WebhookResponse
} from '@/types/webhooks';
import { WebhookError } from '@/types/webhooks';

/**
 * Validate webhook payload
 */
export function validateWebhookPayload(rawPayload: unknown): {
  isValid: boolean;
  error?: string;
  payload?: IntakeQWebhookPayload;
} {
  try {
    if (!rawPayload || typeof rawPayload !== 'object') {
      return {
        isValid: false,
        error: 'Invalid webhook payload structure'
      };
    }

    const payload = rawPayload as IntakeQWebhookPayload;

    // Check required fields
    if (!payload.Type) {
      return {
        isValid: false,
        error: 'Missing required field: Type'
      };
    }

    if (!payload.ClientId) {
      return {
        isValid: false,
        error: 'Missing required field: ClientId'
      };
    }

    // Validate by event type
    switch (payload.Type) {
      case 'Form Submitted':
      case 'Intake Submitted':
        if (!payload.formId) {
          return {
            isValid: false,
            error: 'Missing required field for form submission: formId'
          };
        }
        if (!payload.responses) {
          return {
            isValid: false,
            error: 'Missing required field for form submission: responses'
          };
        }
        break;

      case 'Appointment Created':
      case 'Appointment Updated':
      case 'Appointment Rescheduled':
      case 'Appointment Cancelled':
        if (!payload.Appointment) {
          return {
            isValid: false,
            error: 'Missing required field for appointment event: Appointment'
          };
        }
        if (!payload.Appointment.Id) {
          return {
            isValid: false,
            error: 'Missing required field: Appointment.Id'
          };
        }
        break;

      default:
        return {
          isValid: false,
          error: `Unsupported event type: ${payload.Type}`
        };
    }

    return {
      isValid: true,
      payload
    };
  } catch (error) {
    return {
      isValid: false,
      error: error instanceof Error ? error.message : 'Unknown validation error'
    };
  }
}

/**
 * Create audit log entry for webhook event
 */
export function createWebhookAuditLog(
  event: IntakeQWebhookPayload,
  status: 'received' | 'processed' | 'failed',
  error?: string
): AuditLogEntry {
  const timestamp = new Date().toISOString();
  
  const baseEntry = {
    timestamp,
    user: 'INTAKEQ_WEBHOOK',
    eventType: 'WEBHOOK_RECEIVED',
  };

  switch (status) {
    case 'received':
      return {
        ...baseEntry,
        description: `Received ${event.Type} webhook`,
        systemNotes: JSON.stringify({
          type: event.Type,
          clientId: event.ClientId,
          appointmentId: event.Appointment?.Id
        })
      };

    case 'processed':
      return {
        ...baseEntry,
        eventType: 'WEBHOOK_PROCESSED',
        description: `Successfully processed ${event.Type} webhook`,
        systemNotes: JSON.stringify({
          type: event.Type,
          clientId: event.ClientId,
          appointmentId: event.Appointment?.Id
        })
      };

    case 'failed':
      return {
        ...baseEntry,
        eventType: 'WEBHOOK_FAILED',
        description: `Failed to process ${event.Type} webhook`,
        systemNotes: JSON.stringify({
          type: event.Type,
          clientId: event.ClientId,
          appointmentId: event.Appointment?.Id,
          error
        })
      };

    default:
      throw new Error(`Unsupported audit log status: ${status}`);
  }
}