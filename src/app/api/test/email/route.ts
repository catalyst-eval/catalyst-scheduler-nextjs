// src/app/api/test/email/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { EmailService } from '@/lib/email/service';
import { GoogleSheetsService } from '@/lib/google/sheets';
import { IntakeQService } from '@/lib/intakeq/service';
import { EmailIntegrationTest } from '@/lib/test/email-integration';
import { getGoogleAuthCredentials } from '@/lib/google/auth';

export async function GET(req: NextRequest) {
  try {
    // Get date from query params, default to today
    const searchParams = req.nextUrl.searchParams;
    const date = searchParams.get('date') || new Date().toISOString().split('T')[0];

    console.log('Starting email test for date:', date);

    // Initialize services
    const credentials = getGoogleAuthCredentials();
    const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
    
    if (!spreadsheetId) {
      console.error('Missing GOOGLE_SHEETS_SPREADSHEET_ID environment variable');
      return NextResponse.json({
        success: false,
        error: 'Missing spreadsheet ID configuration'
      }, { status: 500 });
    }

    console.log('Initializing services...');
    
    const sheetsService = new GoogleSheetsService(credentials, spreadsheetId);
    
    const sendgridApiKey = process.env.SENDGRID_API_KEY;
    if (!sendgridApiKey) {
      console.error('Missing SENDGRID_API_KEY environment variable');
      return NextResponse.json({
        success: false,
        error: 'Missing SendGrid API key configuration'
      }, { status: 500 });
    }

    const emailFromAddress = process.env.EMAIL_FROM_ADDRESS;
    const emailFromName = process.env.EMAIL_FROM_NAME;
    if (!emailFromAddress || !emailFromName) {
      console.error('Missing email configuration variables');
      return NextResponse.json({
        success: false,
        error: 'Missing email sender configuration'
      }, { status: 500 });
    }

    const emailService = new EmailService(
      sendgridApiKey,
      emailFromAddress,
      emailFromName,
      sheetsService
    );

    const intakeQApiKey = process.env.INTAKEQ_API_KEY;
    if (!intakeQApiKey) {
      console.error('Missing INTAKEQ_API_KEY environment variable');
      return NextResponse.json({
        success: false,
        error: 'Missing IntakeQ API key configuration'
      }, { status: 500 });
    }

    const intakeQService = new IntakeQService(
      intakeQApiKey,
      sheetsService
    );

    console.log('Services initialized, running test...');

    // Create and run test
    const tester = new EmailIntegrationTest(
      emailService,
      sheetsService,
      intakeQService
    );

    const results = await tester.testEmailIntegration(date);
    
    console.log('Test completed:', results);

    return NextResponse.json(results);

  } catch (error) {
    console.error('Email test failed:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      },
      { status: 500 }
    );
  }
}