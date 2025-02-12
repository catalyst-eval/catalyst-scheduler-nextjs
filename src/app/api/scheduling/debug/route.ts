// src/app/api/scheduling/debug/route.ts

import { NextResponse } from 'next/server';
import { initializeGoogleSheets } from '@/lib/google/auth';

export async function GET() {
  try {
    // Add detailed logging
    console.log('Starting debug endpoint...');
    
    // Check environment variables
    const envCheck = {
      hasSpreadsheetId: !!process.env.GOOGLE_SHEETS_SPREADSHEET_ID,
      hasClientEmail: !!process.env.GOOGLE_SHEETS_CLIENT_EMAIL,
      hasPrivateKey: !!process.env.GOOGLE_SHEETS_PRIVATE_KEY,
    };
    
    console.log('Environment check:', envCheck);

    if (!envCheck.hasSpreadsheetId || !envCheck.hasClientEmail || !envCheck.hasPrivateKey) {
      throw new Error('Missing required environment variables');
    }

    console.log('Initializing Google Sheets service...');
    const sheetsService = await initializeGoogleSheets();
    
    console.log('Fetching offices...');
    const offices = await sheetsService.getOffices();
    console.log('Offices count:', offices?.length ?? 0);
    
    // Also fetch rules and client preferences for complete debugging
    console.log('Fetching rules...');
    const rules = await sheetsService.getAssignmentRules();
    
    console.log('Fetching client preferences...');
    const preferences = await sheetsService.getClientPreferences();
    
    return NextResponse.json({
      success: true,
      data: {
        environmentCheck: envCheck,
        offices: {
          count: offices?.length ?? 0,
          data: offices
        },
        rules: {
          count: rules?.length ?? 0,
          data: rules
        },
        preferences: {
          count: preferences?.length ?? 0,
          data: preferences
        }
      }
    });
  } catch (error) {
    console.error('Detailed error:', error);
    
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : 'An unknown error occurred',
        details: error
      },
      { status: 500 }
    );
  }
}