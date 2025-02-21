// src/lib/intakeq/service.ts

import type { IntakeQAppointment } from '@/types/webhooks';
import type { StandardOfficeId } from '@/types/scheduling';
import { GoogleSheetsService, AuditEventType } from '@/lib/google/sheets';
import { standardizeOfficeId } from '@/lib/util/office-id';
import crypto from 'crypto';

export class IntakeQService {
  private readonly baseUrl: string;
  private readonly headers: HeadersInit;
  private readonly MAX_RETRIES = 3;
  private readonly RETRY_DELAY = 1000; // 1 second base delay

  constructor(
    private readonly apiKey: string,
    private readonly sheetsService: GoogleSheetsService,
    baseUrl: string = 'https://intakeq.com/api/v1',
    private readonly useMockData: boolean = false
  ) {
    this.baseUrl = baseUrl;
    this.headers = {
      'X-Auth-Key': apiKey,
      'Accept': 'application/json'
    };
  }

  async getAppointments(startDate: string, endDate: string): Promise<IntakeQAppointment[]> {
    try {
      console.log('Fetching IntakeQ appointments:', { startDate, endDate });

      // Convert dates to EST and set proper day boundaries
      const requestedStart = new Date(startDate);
      const requestedEnd = new Date(endDate);

      // Ensure we're working with EST dates
      const startEST = new Date(requestedStart.toLocaleString('en-US', { timeZone: 'America/New_York' }));
      const endEST = new Date(requestedEnd.toLocaleString('en-US', { timeZone: 'America/New_York' }));
      startEST.setHours(0, 0, 0, 0);
      endEST.setHours(23, 59, 59, 999);

      console.log('Date ranges (EST):', {
        start: startEST.toLocaleString('en-US', { timeZone: 'America/New_York' }),
        end: endEST.toLocaleString('en-US', { timeZone: 'America/New_York' })
      });

      const params = new URLSearchParams({
        StartDate: startEST.getTime().toString(),
        EndDate: endEST.getTime().toString(),
        Status: 'Confirmed,WaitingConfirmation,Pending',
        dateField: 'StartDateIso'
      });

      const url = `${this.baseUrl}/appointments?${params}`;

      console.log('IntakeQ Request:', {
        endpoint: '/appointments',
        params: Object.fromEntries(params),
        requestRange: {
          start: startEST.toLocaleString('en-US', { timeZone: 'America/New_York' }),
          end: endEST.toLocaleString('en-US', { timeZone: 'America/New_York' })
        }
      });

      let attempt = 0;
      let response;
      let lastError;

      while (attempt < this.MAX_RETRIES) {
        try {
          response = await fetch(url, {
            method: 'GET',
            headers: this.headers
          });

          if (response.ok) break;

          const errorText = await response.text();
          lastError = `HTTP ${response.status}: ${errorText}`;
          
          console.log(`Attempt ${attempt + 1} failed:`, {
            status: response.status,
            error: lastError
          });

          attempt++;
          if (attempt < this.MAX_RETRIES) {
            const delay = this.RETRY_DELAY * Math.pow(2, attempt - 1);
            await new Promise(resolve => setTimeout(resolve, delay));
          }
        } catch (error) {
          lastError = error instanceof Error ? error.message : 'Unknown error';
          console.error(`Attempt ${attempt + 1} error:`, lastError);
          
          attempt++;
          if (attempt < this.MAX_RETRIES) {
            const delay = this.RETRY_DELAY * Math.pow(2, attempt - 1);
            await new Promise(resolve => setTimeout(resolve, delay));
          }
        }
      }

      if (!response || !response.ok) {
        throw new Error(`IntakeQ API error after ${this.MAX_RETRIES} attempts: ${lastError}`);
      }

      const text = await response.text();
      console.log('Raw IntakeQ Response:', text.substring(0, 500) + '...');

      const appointments = JSON.parse(text);

      // Filter appointments to match requested date in EST
      const filteredAppointments = appointments.filter((appt: IntakeQAppointment) => {
        const apptDate = new Date(appt.StartDateIso);
        const apptEST = new Date(apptDate.toLocaleString('en-US', { timeZone: 'America/New_York' }));
        apptEST.setHours(0, 0, 0, 0);  // Compare dates only

        const targetEST = new Date(requestedStart.toLocaleString('en-US', { timeZone: 'America/New_York' }));
        targetEST.setHours(0, 0, 0, 0);  // Compare dates only

        console.log('Appointment comparison:', {
          id: appt.Id,
          client: appt.ClientName,
          apptDate: apptEST.toLocaleString('en-US', { timeZone: 'America/New_York' }),
          targetDate: targetEST.toLocaleString('en-US', { timeZone: 'America/New_York' }),
          matches: apptEST.getTime() === targetEST.getTime()
        });

        return apptEST.getTime() === targetEST.getTime();
      });

      console.log('IntakeQ Response:', {
        status: response.status,
        totalReturned: appointments.length,
        matchingDateRange: filteredAppointments.length,
        sampleAppointment: filteredAppointments[0] ? {
          id: filteredAppointments[0].Id,
          name: filteredAppointments[0].ClientName,
          date: filteredAppointments[0].StartDateLocalFormatted,
          status: filteredAppointments[0].Status
        } : null
      });

      return filteredAppointments;
    } catch (error) {
      console.error('IntakeQ API Error:', error instanceof Error ? error.message : 'Unknown error');
      
      await this.sheetsService.addAuditLog({
        timestamp: new Date().toISOString(),
        eventType: AuditEventType.SYSTEM_ERROR,
        description: 'IntakeQ API error',
        user: 'SYSTEM',
        systemNotes: error instanceof Error ? error.message : 'Unknown error'
      });
      
      throw error;
    }
  }

  async validateWebhookSignature(payload: string, signature: string): Promise<boolean> {
    try {
      const secret = process.env.INTAKEQ_WEBHOOK_SECRET;
      if (!secret) {
        console.error('Missing INTAKEQ_WEBHOOK_SECRET environment variable');
        return false;
      }

      // Remove any quotes from the secret
      const cleanSecret = secret.replace(/['"]/g, '');

      // Create HMAC
      const hmac = crypto.createHmac('sha256', cleanSecret);
      hmac.update(payload);
      const calculatedSignature = hmac.digest('hex');

      console.log('Webhook Signature Validation:', {
        signatureMatches: calculatedSignature === signature,
        calculatedLength: calculatedSignature.length,
        providedLength: signature.length,
        payloadLength: payload.length,
      });

      return calculatedSignature === signature;
    } catch (error) {
      console.error('Webhook signature validation error:', error);
      return false;
    }
  }

  async testConnection(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/practitioners`, {
        headers: this.headers
      });

      console.log('IntakeQ Connection Test:', {
        status: response.status,
        ok: response.ok
      });

      return response.ok;
    } catch (error) {
      console.error('IntakeQ connection test failed:', error instanceof Error ? error.message : 'Unknown error');
      return false;
    }
  }

  /**
   * Helper method to extract and standardize office ID from IntakeQ appointment
   */
  private async getStandardizedOfficeId(appointment: IntakeQAppointment): Promise<StandardOfficeId> {
    try {
      // If appointment already has an office assignment from our system, use that
      if (appointment.Location) {
        return standardizeOfficeId(appointment.Location);
      }

      // Get clinician's default office
      const clinicians = await this.sheetsService.getClinicians();
      const clinician = clinicians.find(c => c.intakeQPractitionerId === appointment.PractitionerId);

      if (clinician?.preferredOffices?.length) {
        return standardizeOfficeId(clinician.preferredOffices[0]);
      }

      // Default to A-a if no other assignment possible
      return 'A-a' as StandardOfficeId;
    } catch (error) {
      console.error('Error standardizing office ID:', error);
      return 'A-a' as StandardOfficeId;
    }
  }

  /**
   * Validate if an office ID is properly formatted
   */
  private isValidOfficeId(officeId: string): boolean {
    return /^[A-Z]-[a-z]$/.test(officeId);
  }
}