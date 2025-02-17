// src/app/api/scheduling/reset/route.ts
import { NextResponse } from 'next/server';
import { initializeGoogleSheets } from '@/lib/google/auth';

export async function POST(request: Request) {
  try {
    const sheetsService = await initializeGoogleSheets();
    
    // Get all appointments
    const appointments = await sheetsService.getAppointments(
      new Date().toISOString(),
      new Date(2025, 11, 31).toISOString()
    );
    
    // Delete all appointments
    for (const appt of appointments) {
      await sheetsService.deleteAppointment(appt.appointmentId);
    }

    // Clear cache
    sheetsService.clearCache();

    return NextResponse.json({
      success: true,
      message: 'Database reset complete'
    });
  } catch (error) {
    console.error('Reset error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}