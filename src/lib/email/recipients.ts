// src/lib/email/recipients.ts

import { GoogleSheetsService } from '@/lib/google/sheets';
import type { EmailRecipient } from './service';

export class RecipientManagementService {
  constructor(private readonly sheetsService: GoogleSheetsService) {}

  /**
   * Get all active recipients
   */
  async getAllRecipients(): Promise<EmailRecipient[]> {
    const clinicians = await this.sheetsService.getClinicians();
    
    return clinicians
      .filter(clinician => clinician.email && clinician.role !== 'intern')
      .map(clinician => ({
        email: clinician.email,
        name: clinician.name,
        role: this.mapRole(clinician.role),
        preferences: this.getDefaultPreferences(clinician.role)
      }));
  }

  /**
   * Get recipients by role
   */
  async getRecipientsByRole(role: 'admin' | 'clinician'): Promise<EmailRecipient[]> {
    const allRecipients = await this.getAllRecipients();
    return allRecipients.filter(recipient => recipient.role === role);
  }

  /**
   * Get recipients for daily schedule
   */
  async getDailyScheduleRecipients(): Promise<EmailRecipient[]> {
    const allRecipients = await this.getAllRecipients();
    return allRecipients.filter(
      recipient => recipient.preferences?.dailySchedule !== false
    );
  }

  /**
   * Get recipients for error notifications
   */
  async getErrorNotificationRecipients(): Promise<EmailRecipient[]> {
    const allRecipients = await this.getAllRecipients();
    return allRecipients.filter(
      recipient => recipient.role === 'admin' && recipient.preferences?.errors !== false
    );
  }

  /**
   * Get recipients for conflict notifications
   */
  async getConflictNotificationRecipients(): Promise<EmailRecipient[]> {
    const allRecipients = await this.getAllRecipients();
    return allRecipients.filter(
      recipient => recipient.preferences?.conflicts !== false
    );
  }

  private mapRole(role: string): 'admin' | 'clinician' {
    return role === 'owner' || role === 'admin' ? 'admin' : 'clinician';
  }

  private getDefaultPreferences(role: string): EmailRecipient['preferences'] {
    const isAdmin = role === 'owner' || role === 'admin';

    return {
      dailySchedule: true,
      conflicts: true,
      errors: isAdmin // Only admins get error notifications by default
    };
  }
}