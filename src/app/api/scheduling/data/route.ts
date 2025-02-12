// src/app/api/scheduling/data/route.ts

import { NextResponse } from 'next/server';
import { initializeGoogleSheets } from '@/lib/google/auth';

export async function GET(request: Request) {
  try {
    const sheetsService = await initializeGoogleSheets();
    
    // Get the date range from query parameters or use default (today)
    const url = new URL(request.url);
    const startDate = url.searchParams.get('startDate') || new Date().toISOString().split('T')[0];
    const endDate = url.searchParams.get('endDate') || startDate;

    // Fetch all required data
    const [offices, clinicians, appointments] = await Promise.all([
      sheetsService.getOffices(),
      sheetsService.getClinicians(),
      sheetsService.getAppointments(
        `${startDate}T00:00:00Z`,
        `${endDate}T23:59:59Z`
      )
    ]);

    return NextResponse.json({
      success: true,
      data: {
        offices,
        clinicians,
        appointments
      }
    });
  } catch (error) {
    console.error('Error fetching schedule data:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : 'Failed to fetch schedule data'
      },
      { status: 500 }
    );
  }
}