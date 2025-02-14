// src/app/api/webhooks/intakeq/route.ts

import { NextResponse } from 'next/server';
import { initializeGoogleSheets } from '@/lib/google/auth';
import { AppointmentSyncHandler } from '@/lib/intakeq/appointment-sync';
import { processAccessibilityForm } from '@/lib/intakeq/accessibility-form';
import type { IntakeQWebhookPayload, WebhookResponse } from '@/types/webhooks';

export async function POST(request: Request): Promise<NextResponse<WebhookResponse>> {
  try {
    // Parse and validate payload
    const rawBody = await request.text();
    console.log('Debug - Raw webhook payload:', rawBody);
    
    let payload: IntakeQWebhookPayload;
    
    try {
      payload = JSON.parse(rawBody);
      console.log('Debug - Parsed payload:', payload);
    } catch (e) {
      console.error('Debug - JSON parse error:', e);
      throw new Error('Invalid JSON payload');
    }

    // Log specific fields we're looking for
    console.log('Debug - Type field:', payload.Type);
    console.log('Debug - ClientId field:', payload.ClientId);
    console.log('Debug - All top-level keys:', Object.keys(payload));

    const eventType = payload.Type || payload.EventType;
    if (!eventType || !payload.ClientId) {
      console.log('Debug - Missing fields. EventType:', eventType, 'ClientId:', payload.ClientId);
      throw new Error('Missing required fields');
    }

    // Initialize services
    const sheetsService = await initializeGoogleSheets();
    
    // Process based on webhook type
    if (payload.Type === 'Intake Submitted' || payload.Type === 'Form Submitted') {
      // Handle form submissions
      if (payload.formId === '67a52367e11d09a2b82d57a9') {
        if (!payload.responses) {
          throw new Error('Missing form responses');
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
        throw new Error(result.error || 'Appointment processing failed');
      }
    } else {
      throw new Error(`Unsupported event type: ${payload.Type}`);
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
    
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    }, { 
      status: 500 
    });
  }
}