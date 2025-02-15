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
      // Use direct date manipulation to match IntakeQ's format
      const start = new Date(startDate);
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);

      // Apply timezone offset
      const startOffset = start.getTimezoneOffset() * 60 * 1000;
      const endOffset = end.getTimezoneOffset() * 60 * 1000;

      // Get timestamps in milliseconds
      const startTimestamp = start.getTime() - startOffset;
      const endTimestamp = end.getTime() - endOffset;

      const params = new URLSearchParams({
        StartDate: startTimestamp.toString(),
        EndDate: endTimestamp.toString(),
        Status: 'Confirmed,WaitingConfirmation'
      });

      const url = `${this.baseUrl}/appointments?${params}`;

      console.log('IntakeQ Request:', {
        endpoint: '/appointments',
        startDate,
        endDate,
        params: Object.fromEntries(params),
        startTimestamp,
        endTimestamp
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

      const data = JSON.parse(text);

      console.log('IntakeQ Response:', {
        status: response.status,
        appointmentCount: Array.isArray(data) ? data.length : 'Invalid response',
        sampleAppointment: Array.isArray(data) && data.length > 0 ? {
          id: data[0].Id,
          status: data[0].Status,
          startDate: data[0].StartDateIso
        } : null
      });

      return Array.isArray(data) ? data : [];
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