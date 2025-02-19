// src/lib/test/email-integration.ts

import { EmailService } from '../email/service';
import { GoogleSheetsService } from '../google/sheets';
import { IntakeQService } from '../intakeq/service';
import { EmailTemplates } from '../email/templates';
import { OfficeAssignmentService } from '../scheduling/office-assignment';
import type { AppointmentRecord } from '@/types/scheduling';

export class EmailIntegrationTest {
  constructor(
    private readonly emailService: EmailService,
    private readonly sheetsService: GoogleSheetsService,
    private readonly intakeQService: IntakeQService
  ) {}

  async testEmailIntegration(date: string): Promise<{
    success: boolean;
    results: {
      appointmentsRetrieved: number;
      emailsSent: number;
      errors: string[];
    };
  }> {
    const errors: string[] = [];
    let appointmentsRetrieved = 0;
    let emailsSent = 0;

    try {
      // 1. Get appointments from Google Sheets
      console.log('Fetching appointments from sheets...');
      const appointments = await this.sheetsService.getAppointments(date, date);
      appointmentsRetrieved = appointments.length;

      if (appointments.length === 0) {
        console.log('No appointments found for date:', date);
        return {
          success: true,
          results: {
            appointmentsRetrieved: 0,
            emailsSent: 0,
            errors: ['No appointments found for specified date']
          }
        };
      }

      // 2. Get necessary data for office assignments
      console.log('Fetching office assignment data...');
      const [offices, rules, clinicians, clientPrefs] = await Promise.all([
        this.sheetsService.getOffices(),
        this.sheetsService.getAssignmentRules(),
        this.sheetsService.getClinicians(),
        this.sheetsService.getClientPreferences()
      ]);

      // 3. Create office assignment service
      const assignmentService = new OfficeAssignmentService(
        offices,
        rules,
        clinicians
      );

      // 4. Assign offices for each appointment
      console.log('Assigning offices...');
      const assignedAppointments = await Promise.all(
        appointments.map(async (appt) => {
          // Get client preferences if they exist
          const clientPref = clientPrefs.find(p => p.clientId === appt.clientId);
          
          // Validate office ID format if it exists
          const validateOfficeId = (officeId?: string) => {
            if (!officeId) return undefined;
            // Check if it matches the pattern 'A-a' format
            const match = /^[A-Z]-[a-z]$/.test(officeId);
            return match ? officeId as `${Uppercase<string>}-${Lowercase<string>}` : undefined;
          };

          // Convert to scheduling request
          const request = {
            clientId: appt.clientId,
            clinicianId: appt.clinicianId,
            dateTime: appt.startTime,
            duration: this.calculateDuration(appt.startTime, appt.endTime),
            sessionType: appt.sessionType,
            requirements: {
              accessibility: Boolean(clientPref?.mobilityNeeds?.length),
              specialFeatures: clientPref?.specialFeatures || [],
              roomPreference: validateOfficeId(clientPref?.assignedOffice)
            }
          };

          // Get office assignment
          const result = await assignmentService.findOptimalOffice(request);
          
          if (result.success && result.officeId) {
            return {
              ...appt,
              officeId: result.officeId
            };
          }
          
          return appt;
        })
      );

      // 5. Create test email template
      const template = EmailTemplates.dailySchedule({
        date,
        appointments: assignedAppointments,
        alerts: [{
          type: 'TEST',
          message: 'This is a test email from the integration test system',
          severity: 'low'
        }]
      });

      // 6. Send test email to admin
      console.log('Sending test email to admin...');
      try {
        await this.emailService.sendEmail(
          [{
            email: 'admin@bridgefamilytherapy.com',
            name: 'Bridge Family Therapy Admin',
            role: 'admin'
          }],
          template,
          {
            type: 'schedule',
            priority: 'normal',
            retryCount: 2
          }
        );
        emailsSent = 1;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        errors.push(`Email send failed: ${errorMessage}`);
      }

      // 7. Log success
      await this.sheetsService.addAuditLog({
        timestamp: new Date().toISOString(),
        eventType: 'EMAIL_TEST',
        description: 'Email integration test completed',
        user: 'SYSTEM',
        systemNotes: JSON.stringify({
          appointmentsRetrieved,
          emailsSent,
          errors
        })
      });

      return {
        success: errors.length === 0,
        results: {
          appointmentsRetrieved,
          emailsSent,
          errors
        }
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('Email integration test failed:', errorMessage);
      
      await this.sheetsService.addAuditLog({
        timestamp: new Date().toISOString(),
        eventType: 'SYSTEM_ERROR',
        description: 'Email integration test failed',
        user: 'SYSTEM',
        systemNotes: errorMessage
      });

      return {
        success: false,
        results: {
          appointmentsRetrieved,
          emailsSent,
          errors: [...errors, errorMessage]
        }
      };
    }
  }

  private calculateDuration(startTime: string, endTime: string): number {
    const start = new Date(startTime);
    const end = new Date(endTime);
    return Math.round((end.getTime() - start.getTime()) / (1000 * 60)); // Duration in minutes
  }
}