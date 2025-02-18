// src/app/api/scheduling/test-daily/route.ts

import { NextResponse } from 'next/server';
import { initializeGoogleSheets } from '@/lib/google/auth';
import { IntakeQService } from '@/lib/intakeq/service';
import { initializeEmailService } from '@/lib/email/config';
import { EmailTemplates } from '@/lib/email/templates';
import { DailyAssignmentService } from '@/lib/scheduling/daily-assignment-service';
import { RecipientManagementService } from '@/lib/email/recipients';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const requestedDate = searchParams.get('date') || '2025-02-17';
    const testType = searchParams.get('test');
    
    console.log('Starting daily schedule test for:', requestedDate);
    
    // Create date in EST
    const targetDate = new Date(requestedDate + 'T12:00:00.000Z'); // Use noon to avoid timezone edge cases
    const estDateStr = targetDate.toLocaleString('en-US', { 
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
    
    console.log('Timezone handling:', {
      requested: requestedDate,
      estDate: estDateStr,
      isoString: targetDate.toISOString()
    });
    
    // Convert to ISO string for consistency
    const dateStr = targetDate.toISOString();
    
    console.log('Date configuration:', {
      requested: requestedDate,
      target: dateStr,
      estLocal: targetDate.toLocaleString('en-US', { timeZone: 'America/New_York' })
    });
    
    // Initialize services
    const sheetsService = await initializeGoogleSheets();
    console.log('Sheets service initialized');
    
    const intakeQService = new IntakeQService(
      process.env.INTAKEQ_API_KEY!,
      sheetsService
    );
    console.log('IntakeQ service initialized');

    const emailService = await initializeEmailService(sheetsService);
    console.log('Email service initialized');

    // Get today's date in EST/EDT
    const estDate = new Date(targetDate.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    console.log('Testing for date:', estDate.toISOString().split('T')[0]);

    // Test IntakeQ connection
    const connected = await intakeQService.testConnection();
    console.log('IntakeQ connection test:', connected);

    if (!connected) {
      throw new Error('Failed to connect to IntakeQ');
    }

    // Get appointments for the full target date
    const startOfDay = `${dateStr.split('T')[0]}T00:00:00Z`;
    const endOfDay = `${dateStr.split('T')[0]}T23:59:59Z`;
    
    console.log('Appointment search range:', {
      startOfDay,
      endOfDay,
      timezone: 'UTC'
    });

    const appointments = await intakeQService.getAppointments(
      startOfDay,
      endOfDay
    );
    console.log('Retrieved appointments:', appointments.length);

    // Use DailyAssignmentService to get full summary with office assignments
    const assignmentService = new DailyAssignmentService(
      sheetsService,
      intakeQService
    );
    const summary = await assignmentService.generateDailySummary(dateStr);
    console.log('Generated daily summary:', {
      appointments: summary.appointments.length,
      conflicts: summary.conflicts.length,
      alerts: summary.alerts.length
    });

    // Create email template
    const template = EmailTemplates.dailySchedule(summary);
    console.log('Created email template');

    // Send test email
    await emailService.sendEmail(
      [{
        email: 'tyler@bridgefamilytherapy.com',
        name: 'Tyler',
        role: 'admin',
        preferences: {
          dailySchedule: true,
          conflicts: true,
          errors: true
        }
      }],
      template,
      {
        type: 'schedule',
        priority: summary.alerts.some(a => a.severity === 'high') ? 'high' : 'normal',
        retryCount: 3
      }
    );
    console.log('Email sent successfully');

    return NextResponse.json({
      success: true,
      data: {
        date: dateStr,
        appointments: summary.appointments.map(appt => ({
          id: appt.appointmentId,
          clientId: appt.clientId,
          officeId: appt.officeId,
          startTime: appt.startTime,
          endTime: appt.endTime,
          sessionType: appt.sessionType
        })),
        conflicts: summary.conflicts,
        alerts: summary.alerts
      }
    });

  } catch (error) {
    console.error('Daily schedule test error:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      },
      { status: 500 }
    );
  }
}