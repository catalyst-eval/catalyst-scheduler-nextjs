import { NextResponse } from 'next/server';
import { initializeGoogleSheets } from '@/lib/google/auth';
import { IntakeQService } from '@/lib/intakeq/service';

export async function GET(request: Request) {
  try {
    const sheetsService = await initializeGoogleSheets();
    const intakeQService = new IntakeQService(
      process.env.INTAKEQ_API_KEY!,
      sheetsService
    );
    
    // Get the date range from query parameters or use default (today)
    const url = new URL(request.url);
    const startDate = url.searchParams.get('startDate') || new Date().toISOString().split('T')[0];
    const endDate = url.searchParams.get('endDate') || startDate;

    // Fetch all required data concurrently
    const [offices, clinicians, appointments] = await Promise.all([
      sheetsService.getOffices(),
      sheetsService.getClinicians(),
      intakeQService.getAppointments(
        `${startDate}T00:00:00Z`,
        `${endDate}T23:59:59Z`
      )
    ]);

    return NextResponse.json({
      success: true,
      data: {
        offices,
        clinicians,
        appointments: appointments.map(appt => ({
          appointmentId: appt.Id,
          clientId: appt.ClientId.toString(),
          clinicianId: appt.PractitionerId,
          sessionType: appt.ServiceName,
          startTime: appt.StartDateIso,
          endTime: appt.EndDateIso,
          status: appt.Status.toLowerCase(),
          lastUpdated: new Date(appt.DateCreated * 1000).toISOString(),
          source: 'intakeq'
        }))
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