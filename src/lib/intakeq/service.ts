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
      console.log('Fetching IntakeQ appointments:', { startDate, endDate });
      
      // Convert to EST dates
      const requestedStart = new Date(startDate);
      const requestedEnd = new Date(endDate);
      
      // Add buffer days to ensure we get all appointments
      const bufferStart = new Date(requestedStart);
      bufferStart.setDate(bufferStart.getDate() - 1);
      const bufferEnd = new Date(requestedEnd);
      bufferEnd.setDate(bufferEnd.getDate() + 1);
  
      console.log('Date ranges:', {
        requested: {
          start: requestedStart.toISOString(),
          end: requestedEnd.toISOString()
        },
        buffered: {
          start: bufferStart.toISOString(),
          end: bufferEnd.toISOString()
        }
      });
  
      const params = new URLSearchParams({
        StartDate: bufferStart.getTime().toString(),
        EndDate: bufferEnd.getTime().toString(),
        Status: 'Confirmed,WaitingConfirmation',
        dateField: 'StartDateIso'
      });
  
      const url = `${this.baseUrl}/appointments?${params}`;
  
      console.log('IntakeQ Request:', {
        endpoint: '/appointments',
        params: Object.fromEntries(params),
        requestedRange: {
          start: requestedStart.toISOString(),
          end: requestedEnd.toISOString()
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
  
      // In getAppointments method
const filteredAppointments = appointments.filter((appt: IntakeQAppointment) => {
  const apptDate = new Date(appt.StartDateIso);
  const requestStart = new Date(requestedStart);
  const requestEnd = new Date(requestedEnd);
  
  // Convert to EST strings for comparison
  const apptESTDate = apptDate.toLocaleString('en-US', { timeZone: 'America/New_York' }).split(',')[0];
  const targetESTDate = requestStart.toLocaleString('en-US', { timeZone: 'America/New_York' }).split(',')[0];
  
  console.log('Comparing dates:', {
    appointment: {
      id: appt.Id,
      name: appt.ClientName,
      date: apptESTDate,
      status: appt.Status,
      time: appt.StartDateLocalFormatted
    },
    target: targetESTDate
  });

  return apptESTDate === targetESTDate;
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