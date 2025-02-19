// src/app/api/webhooks/intakeq/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { GoogleSheetsService } from '@/lib/google/sheets';
import { IntakeQService } from '@/lib/intakeq/service';
import { getGoogleAuthCredentials } from '@/lib/google/auth';
import { AppointmentSyncHandler } from '@/lib/intakeq/appointment-sync';
import { EmailService } from '@/lib/email/service';

export async function POST(req: NextRequest) {
  try {
    const payload = await req.json();

    console.log('Received webhook:', { 
      type: payload.EventType || payload.Type,
      clientId: payload.ClientId,
      appointmentId: payload.Appointment?.Id
    });

    // Initialize services
    const credentials = getGoogleAuthCredentials();
    const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
    
    if (!spreadsheetId) {
      throw new Error('Missing spreadsheet ID configuration');
    }

    const sheetsService = new GoogleSheetsService(credentials, spreadsheetId);
    
    const intakeQService = new IntakeQService(
      process.env.INTAKEQ_API_KEY || '',
      sheetsService
    );

    const emailService = new EmailService(
      process.env.SENDGRID_API_KEY || '',
      process.env.EMAIL_FROM_ADDRESS || '',
      process.env.EMAIL_FROM_NAME || '',
      sheetsService
    );

    console.log('Services initialized');

    // Create appointment sync handler
    const syncHandler = new AppointmentSyncHandler(
      sheetsService,
      intakeQService,
      emailService
    );

    // Handle the webhook event
    // Use either EventType or Type (for backward compatibility)
    const eventType = payload.EventType || payload.Type;
    
    if (!eventType) {
      console.warn('Missing event type in webhook payload');
      return NextResponse.json(
        { 
          success: false, 
          error: 'Missing event type',
          timestamp: new Date().toISOString()
        },
        { status: 400 }
      );
    }

    console.log('Processing webhook event:', eventType);

    const result = await syncHandler.processAppointmentEvent(payload);

    console.log('Webhook event processed:', result);

    if (!result.success) {
      return NextResponse.json({
        success: false,
        error: result.error,
        details: result.details,
        timestamp: new Date().toISOString()
      });
    }

    return NextResponse.json({
      success: true,
      data: result.details,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Webhook processing error:', error);
    
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
        timestamp: new Date().toISOString()
      },
      { status: 500 }
    );
  }
}