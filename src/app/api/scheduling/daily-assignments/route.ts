// src/app/api/scheduling/daily-assignments/route.ts

import { NextResponse } from 'next/server';
import { initializeGoogleSheets } from '@/lib/google/auth';
import { initializeEmailService } from '@/lib/email/config';
import { RecipientManagementService } from '@/lib/email/recipients';
import { IntakeQService } from '@/lib/intakeq/service';
import { DailyAssignmentService } from '@/lib/scheduling/daily-assignment-service';
import { EmailTemplates } from '@/lib/email/templates';

export async function GET(request: Request) {
  try {
    // Initialize services
    const sheetsService = await initializeGoogleSheets();
    const emailService = await initializeEmailService(sheetsService);
    const intakeQService = new IntakeQService(
      process.env.INTAKEQ_API_KEY!,
      sheetsService
    );
    const recipientService = new RecipientManagementService(sheetsService);

    // Get date from query parameters or use today
    const url = new URL(request.url);
    const targetDate = url.searchParams.get('date') || new Date().toISOString().split('T')[0];
    console.log('Generating assignments for:', targetDate);

    // Test IntakeQ connection
    console.log('Testing IntakeQ connection...');
    const connected = await intakeQService.testConnection();
    if (!connected) {
      console.error('Failed to connect to IntakeQ API');
      return NextResponse.json(
        { 
          success: false, 
          error: 'Failed to connect to IntakeQ API'
        },
        { status: 500 }
      );
    }
    console.log('IntakeQ connection successful');
    
    // Generate daily summary with both services
    const dailyAssignmentService = new DailyAssignmentService(
      sheetsService,
      intakeQService
    );
    
    console.log('Fetching daily summary...');
    const summary = await dailyAssignmentService.generateDailySummary(targetDate);
    console.log('Summary generated with', summary.appointments.length, 'appointments');

    // Get recipients and send email
    const recipients = await recipientService.getDailyScheduleRecipients();
    const template = EmailTemplates.dailySchedule(summary);
    
    console.log('Sending email to', recipients.length, 'recipients');
    await emailService.sendEmail(recipients, template, {
      type: 'schedule',
      priority: summary.alerts.some(a => a.severity === 'high') ? 'high' : 'normal',
      retryCount: 3
    });

    return NextResponse.json({
      success: true,
      data: {
        date: targetDate,
        appointmentCount: summary.appointments.length,
        conflicts: summary.conflicts,
        alerts: summary.alerts,
        officeUtilization: Object.fromEntries(summary.officeUtilization),
        recipientCount: recipients.length
      }
    });

  } catch (error) {
    console.error('Error processing daily assignments:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : 'Failed to process daily assignments'
      },
      { status: 500 }
    );
  }
}