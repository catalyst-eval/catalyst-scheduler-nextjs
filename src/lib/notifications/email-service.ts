// src/lib/notifications/email-service.ts

import type { 
    DailyScheduleSummary, 
    AppointmentRecord,
    AlertSeverity 
  } from '@/types/scheduling';
  import { GoogleSheetsService, AuditEventType } from '@/lib/google/sheets';
  
  interface EmailRecipient {
    email: string;
    name: string;
    role: 'admin' | 'clinician';
    notificationPreferences?: {
      dailySchedule: boolean;
      conflicts: boolean;
      capacityAlerts: boolean;
    };
  }
  
  interface EmailTemplate {
    subject: string;
    body: string;
  }
  
  export class EmailNotificationService {
    constructor(
      private readonly sheetsService: GoogleSheetsService
    ) {}
  
    /**
     * Send daily assignment notifications
     */
    async sendDailyAssignments(
      summary: DailyScheduleSummary,
      recipients: EmailRecipient[]
    ): Promise<void> {
      try {
        // Filter recipients based on preferences
        const validRecipients = recipients.filter(
          recipient => recipient.notificationPreferences?.dailySchedule !== false
        );
  
        // Log notification attempt
        await this.sheetsService.addAuditLog({
          timestamp: new Date().toISOString(),
          eventType: AuditEventType.DAILY_ASSIGNMENTS_UPDATED,
          description: `Sending daily assignments for ${summary.date}`,
          user: 'SYSTEM',
          systemNotes: JSON.stringify({
            recipientCount: validRecipients.length,
            appointmentCount: summary.appointments.length,
            conflictCount: summary.conflicts.length
          })
        });
  
        // Prepare email content
        const emailContent = this.createDailyAssignmentEmail(summary);
  
        // Send to each recipient
        for (const recipient of validRecipients) {
          try {
            await this.sendEmail(recipient, emailContent);
          } catch (error) {
            console.error(`Failed to send email to ${recipient.email}:`, error);
            
            // Log individual send failure
            await this.sheetsService.addAuditLog({
              timestamp: new Date().toISOString(),
              eventType: AuditEventType.SYSTEM_ERROR,
              description: `Failed to send daily assignments to ${recipient.email}`,
              user: 'SYSTEM',
              systemNotes: error instanceof Error ? error.message : 'Unknown error'
            });
          }
        }
  
        // Log successful completion
        await this.sheetsService.addAuditLog({
          timestamp: new Date().toISOString(),
          eventType: AuditEventType.DAILY_ASSIGNMENTS_UPDATED,
          description: `Successfully sent daily assignments for ${summary.date}`,
          user: 'SYSTEM'
        });
      } catch (error) {
        console.error('Error sending daily assignments:', error);
        throw error;
      }
    }
  
    /**
     * Create daily assignment email content
     */
    private createDailyAssignmentEmail(summary: DailyScheduleSummary): EmailTemplate {
      const hasConflicts = summary.conflicts.length > 0;
      const hasHighPriorityAlerts = summary.alerts.some(a => a.severity === 'high');
  
      const subject = this.createEmailSubject(summary.date, hasConflicts, hasHighPriorityAlerts);
      const body = this.formatDailyAssignmentBody(summary);
  
      return { subject, body };
    }
  
    /**
     * Create email subject line
     */
    private createEmailSubject(
      date: string,
      hasConflicts: boolean,
      hasHighPriorityAlerts: boolean
    ): string {
      let subject = `Daily Schedule - ${date}`;
      
      if (hasHighPriorityAlerts) {
        subject = `⚠️ ${subject} - HIGH PRIORITY ALERTS`;
      } else if (hasConflicts) {
        subject = `⚠️ ${subject} - Conflicts Detected`;
      }
  
      return subject;
    }
  
    /**
     * Format daily assignment email body
     */
    private formatDailyAssignmentBody(summary: DailyScheduleSummary): string {
      return `
        <div style="font-family: Arial, sans-serif;">
          <h1>Daily Schedule - ${summary.date}</h1>
          
          ${this.formatAlerts(summary.alerts)}
          ${this.formatConflicts(summary.conflicts)}
          ${this.formatAppointments(summary.appointments)}
          ${this.formatOfficeUtilization(summary.officeUtilization)}
          
          <hr>
          <p style="color: #666; font-size: 12px;">
            Generated on ${new Date().toLocaleString()}
          </p>
        </div>
      `;
    }
  
    /**
     * Format alerts section
     */
    private formatAlerts(alerts: DailyScheduleSummary['alerts']): string {
      if (alerts.length === 0) return '';
  
      return `
        <div style="margin: 20px 0;">
          <h2 style="color: #2d3748;">Alerts</h2>
          <ul style="list-style-type: none; padding: 0;">
            ${alerts.map(alert => `
              <li style="
                margin: 10px 0;
                padding: 10px;
                border-radius: 4px;
                background-color: ${this.getAlertBackgroundColor(alert.severity)};
                color: ${this.getAlertTextColor(alert.severity)};
              ">
                ${alert.type.toUpperCase()}: ${alert.message}
              </li>
            `).join('')}
          </ul>
        </div>
      `;
    }
  
    /**
     * Format conflicts section
     */
    private formatConflicts(conflicts: DailyScheduleSummary['conflicts']): string {
      if (conflicts.length === 0) return '';
  
      return `
        <div style="margin: 20px 0;">
          <h2 style="color: #2d3748;">Conflicts</h2>
          <ul style="list-style-type: none; padding: 0;">
            ${conflicts.map(conflict => `
              <li style="
                margin: 10px 0;
                padding: 10px;
                border-radius: 4px;
                background-color: ${this.getAlertBackgroundColor(conflict.severity)};
                color: ${this.getAlertTextColor(conflict.severity)};
              ">
                <strong>${conflict.type}:</strong> ${conflict.description}
                ${conflict.officeId ? `<br>(Office: ${conflict.officeId})` : ''}
                ${conflict.appointmentIds ? `<br>Appointments: ${conflict.appointmentIds.join(', ')}` : ''}
              </li>
            `).join('')}
          </ul>
        </div>
      `;
    }
  
    /**
     * Format appointments section
     */
    private formatAppointments(appointments: AppointmentRecord[]): string {
      return `
        <div style="margin: 20px 0;">
          <h2 style="color: #2d3748;">Appointments</h2>
          <table style="width: 100%; border-collapse: collapse; margin-top: 10px;">
            <thead>
              <tr style="background-color: #f7fafc;">
                <th style="padding: 12px; text-align: left; border-bottom: 2px solid #e2e8f0;">Time</th>
                <th style="padding: 12px; text-align: left; border-bottom: 2px solid #e2e8f0;">Office</th>
                <th style="padding: 12px; text-align: left; border-bottom: 2px solid #e2e8f0;">Client</th>
                <th style="padding: 12px; text-align: left; border-bottom: 2px solid #e2e8f0;">Clinician</th>
                <th style="padding: 12px; text-align: left; border-bottom: 2px solid #e2e8f0;">Type</th>
              </tr>
            </thead>
            <tbody>
              ${appointments
                .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
                .map(appt => `
                  <tr style="border-bottom: 1px solid #e2e8f0;">
                    <td style="padding: 12px;">${new Date(appt.startTime).toLocaleTimeString()} - ${new Date(appt.endTime).toLocaleTimeString()}</td>
                    <td style="padding: 12px;">${appt.officeId}</td>
                    <td style="padding: 12px;">${appt.clientId}</td>
                    <td style="padding: 12px;">${appt.clinicianId}</td>
                    <td style="padding: 12px;">${appt.sessionType}</td>
                  </tr>
                `).join('')}
            </tbody>
          </table>
        </div>
      `;
    }
  
    /**
     * Format office utilization section
     */
    private formatOfficeUtilization(utilization: DailyScheduleSummary['officeUtilization']): string {
      return `
        <div style="margin: 20px 0;">
          <h2 style="color: #2d3748;">Office Utilization</h2>
          <table style="width: 100%; border-collapse: collapse; margin-top: 10px;">
            <thead>
              <tr style="background-color: #f7fafc;">
                <th style="padding: 12px; text-align: left; border-bottom: 2px solid #e2e8f0;">Office</th>
                <th style="padding: 12px; text-align: left; border-bottom: 2px solid #e2e8f0;">Utilization</th>
                <th style="padding: 12px; text-align: left; border-bottom: 2px solid #e2e8f0;">Notes</th>
              </tr>
            </thead>
            <tbody>
              ${Array.from(utilization.entries()).map(([officeId, data]) => `
                <tr style="border-bottom: 1px solid #e2e8f0;">
                  <td style="padding: 12px;">${officeId}</td>
                  <td style="padding: 12px;">${Math.round((data.bookedSlots / data.totalSlots) * 100)}%</td>
                  <td style="padding: 12px;">${data.specialNotes?.join(', ') || ''}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
    }
  
    /**
     * Get alert background color based on severity
     */
    private getAlertBackgroundColor(severity: AlertSeverity): string {
      switch (severity) {
        case 'high':
          return '#fee2e2'; // Light red
        case 'medium':
          return '#fef3c7'; // Light yellow
        case 'low':
          return '#d1fae5'; // Light green
        default:
          return '#f3f4f6'; // Light gray
      }
    }
  
    /**
     * Get alert text color based on severity
     */
    private getAlertTextColor(severity: AlertSeverity): string {
      switch (severity) {
        case 'high':
          return '#991b1b'; // Dark red
        case 'medium':
          return '#92400e'; // Dark yellow
        case 'low':
          return '#065f46'; // Dark green
        default:
          return '#1f2937'; // Dark gray
      }
    }
  
    /**
     * Get admin recipients
     */
    private async getAdminRecipients(): Promise<EmailRecipient[]> {
      // In a real implementation, this would fetch from your user management system
      return [
        {
          email: 'admin@example.com',
          name: 'System Admin',
          role: 'admin',
          notificationPreferences: {
            dailySchedule: true,
            conflicts: true,
            capacityAlerts: true
          }
        }
      ];
    }
  
    /**
     * Send email
     */
    private async sendEmail(
      recipient: EmailRecipient,
      template: EmailTemplate
    ): Promise<void> {
      // This is where you would integrate with your email service provider
      // For example, using SendGrid:
      /*
      const msg = {
        to: recipient.email,
        from: 'scheduler@yourcompany.com',
        subject: template.subject,
        html: template.body,
      };
      await sendgrid.send(msg);
      */
      
      // For now, we'll just log
      console.log(`Would send email to ${recipient.email}:`, {
        subject: template.subject,
        body: template.body
      });
    }
  
    /**
     * Create error notification email content
     */
    private createErrorNotificationEmail(
      error: Error,
      context: {
        type: string;
        severity: string;
        details?: any;
      }
    ): EmailTemplate {
      const subject = `[${context.severity.toUpperCase()}] ${context.type} Error Alert`;
      const body = `
        <h1>System Error Detected</h1>
        <p><strong>Error Type:</strong> ${context.type}</p>
        <p><strong>Severity:</strong> ${context.severity}</p>
        <p><strong>Message:</strong> ${error.message}</p>
        ${context.details ? `<p><strong>Details:</strong> ${JSON.stringify(context.details, null, 2)}</p>` : ''}
        <p><strong>Stack Trace:</strong></p>
        <pre>${error.stack}</pre>
      `;
  
      return { subject, body };
    }
  
    /**
     * Create conflict notification email content
     */
    private createConflictNotificationEmail(conflict: {
      type: string;
      description: string;
      severity: string;
      appointments: string[];
    }): EmailTemplate {
      const subject = `[${conflict.severity.toUpperCase()}] Scheduling Conflict Alert`;
      const body = `
        <h1>Scheduling Conflict Detected</h1>
        <p><strong>Type:</strong> ${conflict.type}</p>
        <p><strong>Description:</strong> ${conflict.description}</p>
        <p><strong>Affected Appointments:</strong></p>
        <ul>
          ${conflict.appointments.map(id => `<li>${id}</li>`).join('')}
        </ul>
      `;
  
      return { subject, body };
    }
  }