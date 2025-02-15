// src/app/api/scheduling/test-appointments/route.ts

import { NextResponse } from 'next/server';
import { initializeGoogleSheets } from '@/lib/google/auth';
import { IntakeQService } from '@/lib/intakeq/service';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const sheetsService = await initializeGoogleSheets();
    console.log('Services initialized');
    
    const intakeQService = new IntakeQService(
      process.env.INTAKEQ_API_KEY!,
      sheetsService
    );

    // Get today's date in EST/EDT
    const today = new Date();
    const estDate = new Date(today.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const startDate = estDate.toISOString().split('T')[0];
    const endDate = startDate;

    console.log('Testing appointments fetch:', { 
      date: startDate,
      timeZone: 'America/New_York'
    });

    // Test connection first
    const connected = await intakeQService.testConnection();

    if (!connected) {
      return NextResponse.json({
        success: false,
        error: 'Failed to connect to IntakeQ'
      }, { status: 500 });
    }

    // Fetch appointments
    const appointments = await intakeQService.getAppointments(startDate, endDate);

    return NextResponse.json({
      success: true,
      data: {
        date: startDate,
        timeZone: 'America/New_York',
        count: appointments.length,
        appointments: appointments.map(apt => ({
          id: apt.Id,
          clientName: apt.ClientName,
          startTime: new Date(apt.StartDateIso).toLocaleString('en-US', { timeZone: 'America/New_York' }),
          endTime: new Date(apt.EndDateIso).toLocaleString('en-US', { timeZone: 'America/New_York' }),
          serviceType: apt.ServiceName
        }))
      }
    });

  } catch (error) {
    console.error('Test endpoint error:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      },
      { status: 500 }
    );
  }
}