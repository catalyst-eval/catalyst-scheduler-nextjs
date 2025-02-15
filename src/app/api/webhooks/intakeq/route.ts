// src/app/api/webhooks/intakeq/route.ts

import { NextResponse } from 'next/server';
import { initializeGoogleSheets } from '@/lib/google/auth';
import { IntakeQService } from '@/lib/intakeq/service';
import { AppointmentHandler } from '@/lib/intakeq/appointment-handler';
import type { WebhookResponse } from '@/types/webhooks';

export async function POST(request: Request): Promise<NextResponse<WebhookResponse>> {
  try {
    // Get raw body and signature
    const signature = request.headers.get('x-intakeq-signature');
    const rawBody = await request.text();

    console.log('Webhook request received:', {
      hasSignature: !!signature,
      bodyLength: rawBody.length
    });

    if (!signature) {
      return NextResponse.json({
        success: false,
        error: 'Missing webhook signature',
        timestamp: new Date().toISOString()
      }, { status: 401 });
    }

    // Initialize services
    const sheetsService = await initializeGoogleSheets();
    console.log('Sheets service initialized');
    
    const intakeQService = new IntakeQService(
      process.env.INTAKEQ_API_KEY!,
      sheetsService
    );
    console.log('IntakeQ service initialized');

    // Validate signature
    const isValid = await intakeQService.validateWebhookSignature(rawBody, signature);
    console.log('Signature validation:', { isValid });

    if (!isValid) {
      return NextResponse.json({
        success: false,
        error: 'Invalid webhook signature',
        timestamp: new Date().toISOString()
      }, { status: 401 });
    }

    // Parse payload
    const payload = JSON.parse(rawBody);
    console.log('Processing webhook:', {
      type: payload.Type,
      clientId: payload.ClientId,
      appointmentId: payload.Appointment?.Id,
      startDate: payload.Appointment?.StartDateIso,
      duration: payload.Appointment?.Duration
    });

    // Handle appointment events
    if (payload.Type.startsWith('Appointment')) {
      console.log('Creating appointment handler');
      const handler = new AppointmentHandler(sheetsService);
      console.log('Processing appointment with handler');
      const result = await handler.handleAppointment(payload);
      console.log('Handler result:', result);

      if (!result.success) {
        throw new Error(result.error || 'Failed to process appointment');
      }
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
      error: error instanceof Error ? error.message : 'Unknown error occurred',
      timestamp: new Date().toISOString()
    }, { status: 500 });
  }
}