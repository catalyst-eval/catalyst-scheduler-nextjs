import { type NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { GoogleSheetsService } from '@/lib/google/sheets';
import { IntakeQService } from '@/lib/intakeq/service';
import { getGoogleAuthCredentials } from '@/lib/google/auth';
import { AppointmentSyncHandler } from '@/lib/intakeq/appointment-sync';
import { EmailService } from '@/lib/email/service';

// Change runtime to nodejs
export const runtime = 'nodejs';
export const maxDuration = 300; // Increased for Node.js runtime

// Add specific memory allocation
export const memory = 1024;

export async function POST(req: NextRequest) {
  const startTime = Date.now();
  console.log(`[${new Date().toISOString()}] Starting webhook processing`);
  
  try {
    const signature = req.headers.get('X-IntakeQ-Signature');
    if (!signature) {
      console.warn('Missing signature in webhook request');
      return NextResponse.json({ 
        success: false, 
        error: 'Missing signature',
        timestamp: new Date().toISOString() 
      }, { status: 401 });
    }

    const payload = await req.json();

    console.log('Received webhook:', { 
      type: payload.EventType || payload.Type,
      clientId: payload.ClientId,
      appointmentId: payload.Appointment?.Id,
      timestamp: new Date().toISOString()
    });

    // Initialize services with better error handling
    try {
      const credentials = getGoogleAuthCredentials();
      const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
      
      if (!spreadsheetId) {
        throw new Error('Missing spreadsheet ID configuration');
      }

      const sheetsService = new GoogleSheetsService(credentials, spreadsheetId);
      console.log('Sheets service initialized');
      
      const intakeQService = new IntakeQService(
        process.env.INTAKEQ_API_KEY || '',
        sheetsService
      );
      console.log('IntakeQ service initialized');

      const emailService = new EmailService(
        process.env.SENDGRID_API_KEY || '',
        process.env.EMAIL_FROM_ADDRESS || '',
        process.env.EMAIL_FROM_NAME || '',
        sheetsService
      );
      console.log('Email service initialized');

      // Create appointment sync handler
      const syncHandler = new AppointmentSyncHandler(
        sheetsService,
        intakeQService,
        emailService
      );

      // Handle the webhook event
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
      const processingTime = Date.now() - startTime;
      
      console.log('Webhook event processed:', {
        ...result,
        processingTime: `${processingTime}ms`
      });

      if (!result.success) {
        return NextResponse.json({
          success: false,
          error: result.error,
          details: result.details,
          processingTime,
          timestamp: new Date().toISOString()
        });
      }

      return NextResponse.json({
        success: true,
        data: result.details,
        processingTime,
        timestamp: new Date().toISOString()
      });

    } catch (serviceError) {
      console.error('Service initialization error:', serviceError);
      throw serviceError; // Re-throw to be caught by outer try-catch
    }

  } catch (error: unknown) {
    const processingTime = Date.now() - startTime;
    console.error('Webhook processing error:', {
      error,
      processingTime: `${processingTime}ms`
    });
    
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
        processingTime,
        timestamp: new Date().toISOString()
      },
      { status: 500 }
    );
  }
}