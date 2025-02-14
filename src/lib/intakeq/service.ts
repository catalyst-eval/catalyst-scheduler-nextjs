import crypto from 'crypto';
import type { IntakeQAppointment, IntakeQWebhookPayload } from '@/types/webhooks';
import { GoogleSheetsService, AuditEventType } from '@/lib/google/sheets';
import { AppointmentCache } from '../cache/appointments';

export class IntakeQService {
  private readonly baseUrl: string;
  private readonly headers: HeadersInit;
  private readonly cache: AppointmentCache;

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
    this.cache = new AppointmentCache();
  }

  async getAppointments(startDate: string, endDate: string): Promise<IntakeQAppointment[]> {
    try {
      // Try cache first
      const cacheKey = `appointments:${startDate}:${endDate}`;
      const cached = await this.cache.get<IntakeQAppointment[]>(cacheKey);
      if (cached) {
        return cached;
      }
  
      // Format dates properly for IntakeQ
      const formattedStartDate = new Date(startDate).toISOString();
      const formattedEndDate = new Date(endDate).toISOString();
  
      const params = new URLSearchParams({
        startDate: formattedStartDate,
        endDate: formattedEndDate,
        status: 'scheduled,confirmed'
      });
  
      const response = await fetch(`${this.baseUrl}/appointments?${params}`, {
        method: 'GET',
        headers: this.headers
      });
  
      if (!response.ok) {
        throw new Error(`IntakeQ API error: ${response.status}`);
      }
  
      const appointments = await response.json() as IntakeQAppointment[];
  
      // Cache the results
      await this.cache.set(cacheKey, appointments);
  
      return appointments;
    } catch (error) {
      await this.sheetsService.addAuditLog({
        timestamp: new Date().toISOString(),
        eventType: AuditEventType.SYSTEM_ERROR,
        description: 'Failed to fetch IntakeQ appointments',
        user: 'SYSTEM',
        systemNotes: error instanceof Error ? error.message : 'Unknown error'
      });
      return []; // Return empty array instead of throwing
    }
  }
  
  async getAppointment(appointmentId: string): Promise<IntakeQAppointment | null> {
    try {
      // Try cache first
      const cacheKey = `appointment:${appointmentId}`;
      const cached = await this.cache.get<IntakeQAppointment>(cacheKey);
      if (cached) {
        return cached;
      }
  
      const response = await fetch(`${this.baseUrl}/appointments/${appointmentId}`, {
        method: 'GET',
        headers: this.headers
      });
  
      if (!response.ok) {
        throw new Error(`IntakeQ API error: ${response.status}`);
      }
  
      const appointment = await response.json() as IntakeQAppointment;
  
      // Cache the result
      await this.cache.set(cacheKey, appointment);
  
      return appointment;
    } catch (error) {
      await this.sheetsService.addAuditLog({
        timestamp: new Date().toISOString(),
        eventType: AuditEventType.SYSTEM_ERROR,
        description: `Failed to fetch appointment ${appointmentId}`,
        user: 'SYSTEM',
        systemNotes: error instanceof Error ? error.message : 'Unknown error'
      });
      return null; // Return null instead of throwing
    }
  }

  async validateWebhookSignature(payload: string, signature: string): Promise<boolean> {
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
  }

  async getClinicianAppointments(
    clinicianId: string,
    startDate: string,
    endDate: string
  ): Promise<IntakeQAppointment[]> {
    const appointments = await this.getAppointments(startDate, endDate);
    return appointments.filter(appt => appt.PractitionerId === clinicianId);
  }

  async testConnection(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/practitioners`, {
        headers: this.headers
      });
      return response.ok;
    } catch (error) {
      return false;
    }
  }

  invalidateCache(pattern?: string): void {
    this.cache.invalidate(pattern);
  }
}