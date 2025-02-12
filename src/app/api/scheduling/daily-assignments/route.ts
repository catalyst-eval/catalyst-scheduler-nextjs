// src/app/api/scheduling/daily-assignments/route.ts

import { NextResponse } from 'next/server';
import { initializeGoogleSheets } from '@/lib/google/auth';
import { DailyAssignmentService } from '@/lib/scheduling/daily-assignment-service';
import { EmailNotificationService } from '@/lib/notifications/email-service';

export async function GET(request: Request) {
  try {
    // Get date from query parameters
    const { searchParams } = new URL(request.url);
    const date = searchParams.get('date') || new Date().toISOString().split('T')[0];

    // Initialize services
    const sheetsService = await initializeGoogleSheets();
    const assignmentService = new DailyAssignmentService(sheetsService);

    // Generate summary
    const summary = await assignmentService.generateDailySummary(date);

    return NextResponse.json({
      success: true,
      data: {
        date,
        appointments: summary.appointments,
        conflicts: summary.conflicts,
        alerts: summary.alerts,
        officeUtilization: Array.from(summary.officeUtilization.entries()).map(
          ([officeId, data]) => ({
            officeId,
            ...data
          })
        )
      }
    });

  } catch (error) {
    console.error('Error generating daily summary:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to generate daily summary',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    // Initialize services
    const sheetsService = await initializeGoogleSheets();
    const assignmentService = new DailyAssignmentService(sheetsService);
    const emailService = new EmailNotificationService(sheetsService);

    // Get request date
    const { date = new Date().toISOString().split('T')[0] } = await request.json();

    // Generate summary
    const summary = await assignmentService.generateDailySummary(date);

    // Get recipients (in production, this would come from your user management system)
    const recipients = [
      {
        email: 'admin@example.com',
        name: 'System Admin',
        role: 'admin' as const,
        notificationPreferences: {
          dailySchedule: true,
          conflicts: true,
          capacityAlerts: true
        }
      }
    ];

    // Send notifications
    await emailService.sendDailyAssignments(summary, recipients);

    return NextResponse.json({
      success: true,
      data: {
        date,
        summary: {
          appointmentCount: summary.appointments.length,
          conflictCount: summary.conflicts.length,
          alertCount: summary.alerts.length
        },
        notifications: {
          recipients: recipients.length,
          highPriorityAlerts: summary.alerts.filter(a => a.severity === 'high').length
        }
      }
    });

  } catch (error) {
    console.error('Error processing daily assignments:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to process daily assignments',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}