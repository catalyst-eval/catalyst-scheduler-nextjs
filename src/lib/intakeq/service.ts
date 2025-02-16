// src/lib/intakeq/service.ts

import type { IntakeQAppointment } from '@/types/webhooks';
import { GoogleSheetsService, AuditEventType } from '@/lib/google/sheets';
import crypto from 'crypto';

export class IntakeQService {
  private readonly baseUrl: string;
  private readonly headers: HeadersInit;

  constructor(
    private readonly apiKey: string,
    private readonly sheetsService: GoogleSheetsService,
    baseUrl: string = 'https://intakeq.com/api/v1'
  ) {
    this.baseUrl = baseUrl;
    this.headers = {
      'X-Auth-Key': apiKey,
      'Accept': 'application/json'
    };
  }

  async getAppointments(startDate: string, endDate: string): Promise<IntakeQAppointment[]> {
    try {
      // Convert to local timezone dates
      const localStart = new Date(startDate);
localStart.setUTCHours(0, 0, 0, 0);
const localEnd = new Date(endDate);
localEnd.setUTCHours(23, 59, 59, 999);

      // Add buffer days to ensure we get all appointments
      const bufferStart = new Date(localStart);
      bufferStart.setDate(bufferStart.getDate() - 1);
      const bufferEnd = new Date(localEnd);
      bufferEnd.setDate(bufferEnd.getDate() + 1);

      console.log('Date ranges:', {
        requested: {
          start: localStart.toISOString(),
          end: localEnd.toISOString()
        },
        buffered: {
          start: bufferStart.toISOString(),
          end: bufferEnd.toISOString()
        }
      });

      const params = new URLSearchParams({
        StartDate: bufferStart.getTime().toString(),
        EndDate: bufferEnd.getTime().toString(),
        Status: 'Confirmed,WaitingConfirmation'
      });

      const url = `${this.baseUrl}/appointments?${params}`;

      console.log('IntakeQ Request:', {
        endpoint: '/appointments',
        startDate,
        endDate,
        params: Object.fromEntries(params),
        requestedRange: {
          start: localStart.toISOString(),
          end: localEnd.toISOString()
        }
      });

      const response = await fetch(url, {
        method: 'GET',
        headers: this.headers
      });

      const text = await response.text();
      console.log('Raw IntakeQ Response:', text.substring(0, 500) + '...');

      if (!response.ok) {
        throw new Error(`IntakeQ API error (${response.status}): ${text}`);
      }

      const appointments = JSON.parse(text);

      // Filter appointments to match exactly the requested date range
      const filteredAppointments = appointments.filter((appt: IntakeQAppointment) => {
        // Create dates for comparison using local time
        const appointmentDate = new Date(appt.StartDateLocal);
        
        // Set all dates to midnight for comparison
        appointmentDate.setHours(0,0,0,0);
        const compareStart = new Date(localStart);
        compareStart.setHours(0,0,0,0);
        const compareEnd = new Date(localEnd);
        compareEnd.setHours(0,0,0,0);

        console.log('Comparing dates:', {
          appointment: {
            id: appt.Id,
            name: appt.ClientName,
            date: appointmentDate.toISOString(),
            status: appt.Status,
            time: appt.StartDateLocalFormatted
          },
          range: {
            start: compareStart.toISOString(),
            end: compareEnd.toISOString()
          }
        });

        // Compare using local dates
        return appointmentDate >= compareStart && appointmentDate <= compareEnd;
      });

      console.log('IntakeQ Response:', {
        status: response.status,
        totalReturned: appointments.length,
        matchingDateRange: filteredAppointments.length,
        requestedStartDate: startDate,
        requestedEndDate: endDate,
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
      
      return [];
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
}