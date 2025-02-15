// src/app/api/scheduling/daily-sync/route.ts

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

    // Get today's date in ISO format
    const today = new Date().toISOString().split('T')[0];
    
    // Generate daily summary with both services
    const dailyAssignmentService = new DailyAssignmentService(
      sheetsService,
      intakeQService
    );

    console.log('Starting daily sync for:', today);
    const summary = await dailyAssignmentService.generateDailySummary(today);

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
      data: {
        date: today,
        appointmentCount: summary.appointments.length,
        synchronizedOffices: Array.from(summary.officeUtilization.keys()),
        conflicts: summary.conflicts,
        alerts: summary.alerts
      }
    });

  } catch (error) {
    console.error('Error synchronizing daily schedule:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : 'Failed to synchronize daily schedule'
      },
      { status: 500 }
    );
  }
}