// src/lib/email/service.ts

import type { EmailTemplate } from '@/lib/email/templates';
import SendGrid from '@sendgrid/mail';
import { GoogleSheetsService, AuditEventType } from '@/lib/google/sheets';

export interface EmailRecipient {
  email: string;
  name: string;
  role: 'admin' | 'clinician';
  preferences?: {
    dailySchedule: boolean;
    conflicts: boolean;
    errors: boolean;
  };
}

export class EmailService {
  private readonly fromEmail: string;
  private readonly fromName: string;

  constructor(
    apiKey: string,
    fromEmail: string,
    fromName: string,
    private readonly sheetsService: GoogleSheetsService
  ) {
    SendGrid.setApiKey(apiKey);
    this.fromEmail = fromEmail;
    this.fromName = fromName;
  }

  /**
   * Send email to recipients
   */
  async sendEmail(
    recipients: EmailRecipient[],
    template: EmailTemplate,
    options: {
      type: 'schedule' | 'error' | 'conflict';
      priority?: 'high' | 'normal';
      retryCount?: number;
    }
  ): Promise<void> {
    try {
      const emails = recipients.map(recipient => ({
        to: {
          email: recipient.email,
          name: recipient.name
        },
        from: {
          email: this.fromEmail,
          name: this.fromName
        },
        subject: template.subject,
        html: template.html,
        text: template.text
      }));

      // Log attempt
      await this.sheetsService.addAuditLog({
        timestamp: new Date().toISOString(),
        eventType: 'EMAIL_NOTIFICATION',
        description: `Sending ${options.type} notifications`,
        user: 'SYSTEM',
        systemNotes: JSON.stringify({
          recipientCount: recipients.length,
          subject: template.subject,
          priority: options.priority
        })
      });

      // Send emails in batches of 100 (SendGrid recommendation)
      const batchSize = 100;
      for (let i = 0; i < emails.length; i += batchSize) {
        const batch = emails.slice(i, i + batchSize);
        await SendGrid.send(batch);
      }

      // Log success
      await this.sheetsService.addAuditLog({
        timestamp: new Date().toISOString(),
        eventType: 'EMAIL_NOTIFICATION',
        description: `Successfully sent ${options.type} notifications`,
        user: 'SYSTEM',
        systemNotes: JSON.stringify({
          recipientCount: recipients.length,
          subject: template.subject
        })
      });
    } catch (error) {
      console.error('Error sending emails:', error);

      // Log error
      await this.sheetsService.addAuditLog({
        timestamp: new Date().toISOString(),
        eventType: AuditEventType.SYSTEM_ERROR,
        description: `Failed to send ${options.type} notifications`,
        user: 'SYSTEM',
        systemNotes: error instanceof Error ? error.message : 'Unknown error'
      });

      // Retry if specified
      if (options.retryCount && options.retryCount > 0) {
        console.log(`Retrying email send (${options.retryCount} attempts remaining)...`);
        await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second before retry
        return this.sendEmail(recipients, template, {
          ...options,
          retryCount: options.retryCount - 1
        });
      }

      throw error;
    }
  }

  /**
   * Filter recipients based on preferences
   */
  filterRecipientsByPreference(
    recipients: EmailRecipient[],
    type: 'dailySchedule' | 'conflicts' | 'errors'
  ): EmailRecipient[] {
    return recipients.filter(recipient => {
      if (!recipient.preferences) return true; // Default to including if no preferences set
      return recipient.preferences[type] !== false; // Include unless explicitly set to false
    });
  }

  /**
   * Get admin recipients from sheets
   */
  async getAdminRecipients(): Promise<EmailRecipient[]> {
    try {
      const clinicians = await this.sheetsService.getClinicians();
      
      return clinicians
        .filter(clinician => clinician.role === 'admin' || clinician.role === 'owner')
        .map(clinician => ({
          email: clinician.email,
          name: clinician.name,
          role: clinician.role === 'owner' || clinician.role === 'admin' ? 'admin' as const : 'clinician' as const,
          preferences: {
            dailySchedule: true,
            conflicts: true,
            errors: true
          }
        }));
    } catch (error) {
      console.error('Error getting admin recipients:', error);
      throw error;
    }
  }

  /**
   * Get clinician recipients
   */
  async getClinicianRecipients(): Promise<EmailRecipient[]> {
    try {
      const clinicians = await this.sheetsService.getClinicians();
      
      return clinicians
        .filter(clinician => clinician.role === 'clinician' || clinician.role === 'intern')
        .map(clinician => ({
          email: clinician.email,
          name: clinician.name,
          role: 'clinician',
          preferences: {
            dailySchedule: true,
            conflicts: true,
            errors: false
          }
        }));
    } catch (error) {
      console.error('Error getting clinician recipients:', error);
      throw error;
    }
  }
}