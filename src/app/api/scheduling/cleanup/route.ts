// src/app/api/scheduling/cleanup/route.ts
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
    
    // Delete test appointments
    const testAppointments = appointments.filter(appt => 
      appt.appointmentId.startsWith('test')
    );
    
    for (const appt of testAppointments) {
      await sheetsService.deleteAppointment(appt.appointmentId);
    }
    
    return NextResponse.json({
      success: true,
      deleted: testAppointments.length
    });
  } catch (error) {
    console.error('Cleanup error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}