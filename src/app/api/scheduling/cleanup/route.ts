// src/app/api/scheduling/cleanup/route.ts
import { NextResponse } from 'next/server';
import { initializeGoogleSheets } from '@/lib/google/auth';

export async function POST(request: Request) {
  try {
    const sheetsService = await initializeGoogleSheets();
    const appointments = await sheetsService.getAppointments(
      new Date().toISOString(),
      new Date(2025, 11, 31).toISOString()
    );
    
    let deletedCount = 0;
    for (const appt of appointments) {
      // Delete if:
      // 1. It's a test appointment
      // 2. Has invalid data
      if (
        appt.appointmentId.startsWith('test') ||
        !appt.startTime ||
        appt.startTime === 'scheduled' ||
        appt.officeId.includes('T')
      ) {
        await sheetsService.deleteAppointment(appt.appointmentId);
        deletedCount++;
      }
    }

    // Clear cache
    sheetsService.clearCache();

    return NextResponse.json({
      success: true,
      deleted: deletedCount
    });
  } catch (error) {
    console.error('Cleanup error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}