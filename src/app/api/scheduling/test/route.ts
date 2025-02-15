// src/app/api/scheduling/test/route.ts

import { NextResponse } from 'next/server';
import { initializeGoogleSheets } from '@/lib/google/auth';
import { IntakeQService } from '@/lib/intakeq/service';
import { initializeEmailService } from '@/lib/email/config';
import { EmailTemplates } from '@/lib/email/templates';
import { DailyAssignmentService } from '@/lib/scheduling/daily-assignment-service';

export async function GET(request: Request) {
  try {
    console.log('Starting test endpoint');
    
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
    
    // Get today's date
    const today = new Date().toISOString().split('T')[0];
    console.log('Testing for date:', today);

    // Test IntakeQ connection
    const connected = await intakeQService.testConnection();
    console.log('IntakeQ connection test:', connected);

    if (!connected) {
      throw new Error('Failed to connect to IntakeQ');
    }

    // Get appointments
    const appointments = await intakeQService.getAppointments(
      `${today}T00:00:00Z`,
      `${today}T23:59:59Z`
    );
    console.log('Retrieved appointments:', appointments.length);

    // Use DailyAssignmentService to get full summary with office assignments
    const assignmentService = new DailyAssignmentService(
      sheetsService,
      intakeQService
    );
    const summary = await assignmentService.generateDailySummary(today);
    console.log('Generated daily summary');

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
        priority: 'normal',
        retryCount: 3
      }
    );
    console.log('Email sent successfully');

    return NextResponse.json({
      success: true,
      appointments: appointments.map(appt => ({
        id: appt.Id,
        clientName: appt.ClientName,
        startTime: appt.StartDateIso,
        endTime: appt.EndDateIso,
        serviceType: appt.ServiceName
      })),
      summary: {
        appointmentCount: summary.appointments.length,
        conflicts: summary.conflicts,
        alerts: summary.alerts
      }
    });

  } catch (error) {
    console.error('Test endpoint error:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      },
      { status: 500 }
    );
  }
}