// src/app/api/webhooks/intakeq/route.ts

import { NextResponse } from 'next/server';
import { initializeGoogleSheets } from '@/lib/google/auth';
import { AppointmentSyncHandler } from '@/lib/intakeq/appointment-sync';
import { processAccessibilityForm } from '@/lib/intakeq/accessibility-form';
import type { IntakeQWebhookPayload, WebhookResponse } from '@/types/webhooks';

class WebhookError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number = 500,
    public readonly details?: any
  ) {
    super(message);
    this.name = 'WebhookError';
  }
}

export async function POST(
  request: Request
): Promise<NextResponse<WebhookResponse>> {
  try {
    // Parse and validate payload
    const rawBody = await request.text();
    let payload: IntakeQWebhookPayload;
    
    try {
      payload = JSON.parse(rawBody);
    } catch (e) {
      throw new WebhookError('Invalid JSON payload', 400);
    }

    if (!payload.Type || !payload.ClientId) {
      throw new WebhookError('Missing required fields', 400);
    }

    // Initialize services
    const sheetsService = await initializeGoogleSheets();
    
    // Process based on webhook type
    if (payload.Type === 'Intake Submitted' || payload.Type === 'Form Submitted') {
      // Handle form submissions
      if (payload.formId === '67a52367e11d09a2b82d57a9') {
        if (!payload.responses) {
          throw new WebhookError('Missing form responses', 400);
        }

        const clientPrefs = processAccessibilityForm({
          ...payload.responses,
          clientId: payload.ClientId,
          clientName: payload.responses.clientName,
          clientEmail: payload.responses.clientEmail
        });
        
        await sheetsService.updateClientPreference(clientPrefs);
      }
    } else if (payload.Type.startsWith('Appointment')) {
      // Handle appointment events
      const appointmentHandler = new AppointmentSyncHandler(sheetsService);
      const result = await appointmentHandler.processAppointmentEvent(payload);
      
      if (!result.success) {
        throw new WebhookError(result.error || 'Appointment processing failed', 500);
      }
    } else {
      throw new WebhookError(`Unsupported event type: ${payload.Type}`, 400);
    }

    return NextResponse.json({ success: true });

  } catch (error) {
    console.error('Webhook processing error:', error);

    // Log error if possible
    try {
      const sheetsService = await initializeGoogleSheets();
      await sheetsService.addAuditLog({
        timestamp: new Date().toISOString(),
        eventType: 'SYSTEM_ERROR',
        description: error instanceof Error ? error.message : 'Unknown error',
        user: 'SYSTEM',
        systemNotes: JSON.stringify(error)
      });
    } catch (logError) {
      console.error('Failed to log error:', logError);
    }
    
    const statusCode = error instanceof WebhookError ? error.statusCode : 500;
    
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    }, { 
      status: statusCode 
    });
  }
}