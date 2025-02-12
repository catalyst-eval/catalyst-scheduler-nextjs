// src/app/api/schedule/data/route.ts

import { NextResponse } from 'next/server';
import { initializeGoogleSheets } from '@/lib/google/auth';

export async function GET() {
  try {
    const sheetsService = await initializeGoogleSheets();
    
    // Get today's date in ISO format
    const today = new Date().toISOString().split('T')[0];
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowISO = tomorrow.toISOString().split('T')[0];

    // Fetch all data concurrently
    const [appointments, offices, clinicians] = await Promise.all([
      sheetsService.getAppointments(
        `${today}T00:00:00Z`,
        `${tomorrowISO}T00:00:00Z`
      ),
      sheetsService.getOffices(),
      sheetsService.getClinicians()
    ]);

    return NextResponse.json({
      success: true,
      appointments,
      offices,
      clinicians
    });
  } catch (error) {
    console.error('Error in schedule data API:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : 'An unknown error occurred'
      },
      { status: 500 }
    );
  }
}