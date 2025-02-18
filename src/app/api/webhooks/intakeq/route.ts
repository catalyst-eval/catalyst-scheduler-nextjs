// src/app/api/webhooks/intakeq/route.ts

import { NextResponse } from 'next/server';
import { initializeGoogleSheets } from '@/lib/google/auth';
import { IntakeQService } from '@/lib/intakeq/service';
import { AppointmentSyncHandler } from '@/lib/intakeq/appointment-sync';
import { EnhancedWebhookHandler } from '@/lib/intakeq/webhook-handler';
import { initializeEmailService } from '@/lib/email/config';

export async function POST(request: Request) {
  try {
    // Get raw body
    const rawBody = await request.text();

    console.log('Webhook request received:', {
      bodyLength: rawBody.length,
      rawContent: rawBody
    });

    // Initialize services
    const sheetsService = await initializeGoogleSheets();
    console.log('Sheets service initialized');

    const intakeQService = new IntakeQService(
      process.env.INTAKEQ_API_KEY!,
      sheetsService
    );
    console.log('IntakeQ service initialized');

    const emailService = await initializeEmailService(sheetsService);
    console.log('Email service initialized');

    // Attempt to parse with detailed error logging
    let payload;
    try {
      payload = JSON.parse(rawBody);
      console.log('Parsed payload:', {
        type: payload.Type,
        clientId: payload.ClientId,
        hasResponses: !!payload.responses
      });
    } catch (error) {
      if (error instanceof Error) {
        console.error('JSON Parse Error:', {
          error: error.message,
          rawData: rawBody.substring(0, 200) + '...'
        });
      }
      throw error;
    }

    // Initialize handlers with correct service types
    const appointmentSync = new AppointmentSyncHandler(
      sheetsService,
      intakeQService,
      emailService
    );

    const webhookHandler = new EnhancedWebhookHandler(
      sheetsService,
      appointmentSync
    );

    console.log('Processing webhook:', {
      type: payload.Type || payload.EventType,
      clientId: payload.ClientId,
      appointmentId: payload.Appointment?.Id,
      startDate: payload.Appointment?.StartDateIso,
      duration: payload.Appointment?.Duration
    });

    // Process the webhook
    const result = await webhookHandler.processWebhook(payload);
    console.log('Webhook processing result:', result);

    if (!result.success) {
      throw new Error(result.error || 'Failed to process webhook');
    }

    console.log('Webhook processed successfully');
    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Webhook error:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    }, { status: 500 });
  }
}