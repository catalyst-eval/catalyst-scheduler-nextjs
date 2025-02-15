// src/lib/intakeq/service.ts

import crypto from 'crypto';
import type { IntakeQAppointment } from '@/types/webhooks';
import { GoogleSheetsService, AuditEventType } from '@/lib/google/sheets';

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
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    };
    
    // Log initialization
    console.log('IntakeQ Service initialized:', {
      hasApiKey: !!apiKey,
      baseUrl,
      headers: Object.keys(this.headers)
    });
  }

  async getAppointments(startDate: string, endDate: string): Promise<IntakeQAppointment[]> {
    try {
      console.log('Fetching IntakeQ appointments:', { startDate, endDate });

      // Format dates properly for IntakeQ
      const params = new URLSearchParams({
        startDate: new Date(startDate).toISOString(),
        endDate: new Date(endDate).toISOString(),
        status: 'scheduled,confirmed'
      });

      const url = `${this.baseUrl}/appointments?${params}`;
      console.log('IntakeQ API Request:', {
        url,
        method: 'GET',
        headers: Object.keys(this.headers)
      });

      const response = await fetch(url, {
        method: 'GET',
        headers: this.headers
      });

      console.log('IntakeQ API Response:', {
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers.entries())
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('IntakeQ API Error Response:', {
          status: response.status,
          body: errorText
        });
        throw new Error(`IntakeQ API error: ${response.status} - ${errorText}`);
      }

      const appointments = await response.json();
      console.log('IntakeQ Appointments Retrieved:', {
        count: appointments.length,
        sampleAppointment: appointments[0] ? {
          id: appointments[0].Id,
          startTime: appointments[0].StartDateIso,
          type: appointments[0].ServiceName
        } : null
      });

      return appointments;
    } catch (error) {
      console.error('Error fetching IntakeQ appointments:', error);
      await this.sheetsService.addAuditLog({
        timestamp: new Date().toISOString(),
        eventType: AuditEventType.SYSTEM_ERROR,
        description: 'Failed to fetch IntakeQ appointments',
        user: 'SYSTEM',
        systemNotes: error instanceof Error ? 
          `${error.message}\n${error.stack}` : 
          'Unknown error'
      });
      return []; // Return empty array instead of throwing
    }
  }

  async validateWebhookSignature(payload: string, signature: string): Promise<boolean> {
    try {
      const secret = process.env.INTAKEQ_WEBHOOK_SECRET;
      if (!secret) {
        throw new Error('Webhook secret not configured');
      }

      const hmac = crypto.createHmac('sha256', secret);
      const calculatedSignature = hmac.update(payload).digest('hex');
      
      return crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(calculatedSignature)
      );
    } catch (error) {
      console.error('Error validating webhook signature:', error);
      await this.sheetsService.addAuditLog({
        timestamp: new Date().toISOString(),
        eventType: AuditEventType.SYSTEM_ERROR,
        description: 'Webhook signature validation failed',
        user: 'SYSTEM',
        systemNotes: error instanceof Error ? error.message : 'Unknown error'
      });
      return false;
    }
  }

  async testConnection(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/practitioners`, {
        headers: this.headers
      });
      const success = response.ok;
      console.log('IntakeQ connection test:', {
        success,
        status: response.status,
        statusText: response.statusText
      });
      return success;
    } catch (error) {
      console.error('IntakeQ connection test failed:', error);
      return false;
    }
  }
}