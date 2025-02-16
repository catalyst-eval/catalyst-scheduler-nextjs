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
  const date = searchParams.get('date') || '2025-02-17';
    console.log('Starting daily schedule test');
    
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
    const today = new Date();
    const estDate = new Date(today.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const dateStr = estDate.toISOString().split('T')[0];
    console.log('Testing for date:', dateStr);

    // Test IntakeQ connection
    const connected = await intakeQService.testConnection();
    console.log('IntakeQ connection test:', connected);

    if (!connected) {
      throw new Error('Failed to connect to IntakeQ');
    }

    // Get appointments
    const appointments = await intakeQService.getAppointments(
      `${dateStr}T00:00:00Z`,
      `${dateStr}T23:59:59Z`
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