import { NextResponse } from 'next/server';
import { initializeGoogleSheets } from '@/lib/google/auth';
import { DailyAssignmentService } from '@/lib/scheduling/daily-assignment-service';
import { initializeEmailService } from '@/lib/email/config';
import { RecipientManagementService } from '@/lib/email/recipients';
import { EmailTemplates } from '@/lib/email/templates';
import { AppointmentSyncHandler } from '@/lib/intakeq/appointment-sync';
import { IntakeQService } from '@/lib/intakeq/service';

export async function POST(request: Request) {
  try {
    // Initialize services
    const sheetsService = await initializeGoogleSheets();
    const intakeQService = new IntakeQService(
      process.env.INTAKEQ_API_KEY!,
      sheetsService
    );
    const emailService = await initializeEmailService(sheetsService);
    const recipientService = new RecipientManagementService(sheetsService);
    
    const appointmentHandler = new AppointmentSyncHandler(
      sheetsService,
      intakeQService,
      emailService
    );

    // Get the date from request or use today
    const url = new URL(request.url);
    const date = url.searchParams.get('date') || new Date().toISOString().split('T')[0];
    
    // Set up time range
    const startOfDay = `${date}T00:00:00Z`;
    const endOfDay = `${date}T23:59:59Z`;

    console.log('Debug: Starting IntakeQ sync for date:', date);

    // Get appointments from IntakeQ
    const appointments = await intakeQService.getAppointments(startOfDay, endOfDay);
    console.log('Debug: Found IntakeQ appointments:', appointments.length);

    // Generate daily summary using assignment service
    const dailyAssignmentService = new DailyAssignmentService(sheetsService);
    const summary = await dailyAssignmentService.generateDailySummary(date);

    // Get recipients and send email
    const recipients = await recipientService.getDailyScheduleRecipients();
    const template = EmailTemplates.dailySchedule(summary);
    
    await emailService.sendEmail(recipients, template, {
      type: 'schedule',
      priority: summary.alerts.some(a => a.severity === 'high') ? 'high' : 'normal',
      retryCount: 3
    });

    return NextResponse.json({
      success: true,
      summary: {
        date,
        appointmentCount: appointments.length,
        conflictCount: summary.conflicts.length,
        alertCount: summary.alerts.length,
        appointments: appointments.map(appt => ({
          id: appt.Id,
          clientName: appt.ClientName,
          startTime: appt.StartDateIso,
          sessionType: appt.ServiceName
        }))
      }
    });

  } catch (error) {
    console.error('Error processing daily schedule:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : 'Failed to process daily schedule'
      },
      { status: 500 }
    );
  }
}