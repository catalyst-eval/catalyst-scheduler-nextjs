// src/app/api/scheduling/daily-sync/route.ts

import { NextResponse } from 'next/server';
import { initializeGoogleSheets } from '@/lib/google/auth';
import { DailyAssignmentService } from '@/lib/scheduling/daily-assignment-service';
import { initializeEmailService } from '@/lib/email/config';
import { RecipientManagementService } from '@/lib/email/recipients';
import { EmailTemplates } from '@/lib/email/templates';
import { AppointmentSyncHandler } from '@/lib/intakeq/appointment-sync';

export async function POST(request: Request) {
  try {
    // Initialize services
    const sheetsService = await initializeGoogleSheets();
    const emailService = await initializeEmailService(sheetsService);
    const recipientService = new RecipientManagementService(sheetsService);
    const appointmentHandler = new AppointmentSyncHandler(sheetsService);

    // Get the date from request or use today
    const url = new URL(request.url);
    const date = url.searchParams.get('date') || new Date().toISOString().split('T')[0];
    
    // Set up time range
    const startOfDay = `${date}T00:00:00Z`;
    const endOfDay = `${date}T23:59:59Z`;

    console.log('Debug: Starting IntakeQ sync for date:', date);

    // First sync with IntakeQ
    try {
      const intakeQAppointments = await appointmentHandler.fetchIntakeQAppointments(date);
      console.log('Debug: Found IntakeQ appointments:', intakeQAppointments.length);

      // Validate appointment data
if (!Array.isArray(intakeQAppointments)) {
  throw new Error('Invalid response format from IntakeQ API');
}

      // Process each appointment
      let synced = 0;
      let errors = 0;
      
      for (const appointment of intakeQAppointments) {
        try {
          const result = await appointmentHandler.processAppointmentEvent({
            Type: 'Appointment Created',
            ClientId: appointment.ClientId,
            PracticeId: 'DIRECT_SYNC', // Indicate this came from API not webhook
            ExternalClientId: appointment.ExternalClientId,
            ExternalPracticeId: null,
            Appointment: appointment
          });

          if (result.success) {
            synced++;
          } else {
            errors++;
            console.error('Failed to sync appointment:', appointment.Id, result.error);
          }
        } catch (syncError) {
          errors++;
          console.error('Error syncing appointment:', appointment.Id, syncError);
        }
      }

      console.log('Debug: Sync complete -', { synced, errors });
    } catch (syncError) {
      console.error('Warning: IntakeQ sync failed:', syncError);
      // Continue with existing appointments rather than failing completely
    }

    // Now proceed with existing sheet functionality
    const appointments = await sheetsService.getAppointments(startOfDay, endOfDay);
    console.log('Debug: Sheet appointments after sync:', appointments);

    // Generate daily summary using existing service
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
        appointmentCount: summary.appointments.length,
        conflictCount: summary.conflicts.length,
        alertCount: summary.alerts.length,
        debug: {
          rawAppointmentCount: appointments.length,
          dateRange: {
            start: startOfDay,
            end: endOfDay
          }
        }
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