// src/lib/intakeq/appointment-sync.ts

import { IntakeQWebhookPayload, IntakeQAppointment } from '../../types/webhooks';
import { AppointmentRecord, standardizeOfficeId } from '../../types/scheduling';
import { IGoogleSheetsService, AuditEventType } from '../google/sheets';

// Interface for appointment processing results
export interface AppointmentProcessingResult {
  success: boolean;
  error?: string;
  retryable?: boolean;
  details?: any;
}

export class AppointmentSync {
  constructor(private readonly sheetsService: IGoogleSheetsService) {}

  /**
   * Process appointment webhook events
   */
  async processAppointmentEvent(
    payload: IntakeQWebhookPayload
  ): Promise<AppointmentProcessingResult> {
    try {
      // Ensure we have appointment data
      if (!payload.Appointment) {
        return {
          success: false,
          error: 'No appointment data in payload',
          retryable: false
        };
      }

      // Get event type
      const eventType = payload.EventType || payload.Type;
      if (!eventType) {
        return {
          success: false,
          error: 'Missing event type',
          retryable: false
        };
      }

      // Process based on event type
      if (
        eventType === 'AppointmentCreated' ||
        eventType === 'Appointment Created'
      ) {
        return await this.handleAppointmentCreated(payload.Appointment);
      } else if (
        eventType === 'AppointmentUpdated' ||
        eventType === 'Appointment Updated'
      ) {
        return await this.handleAppointmentUpdated(payload.Appointment);
      } else if (
        eventType === 'AppointmentCancelled' ||
        eventType === 'Appointment Cancelled' ||
        eventType === 'AppointmentCanceled' ||
        eventType === 'Appointment Canceled'
      ) {
        return await this.handleAppointmentCancelled(payload.Appointment);
      } else if (
        eventType === 'AppointmentRescheduled' ||
        eventType === 'Appointment Rescheduled'
      ) {
        return await this.handleAppointmentRescheduled(payload.Appointment);
      } else {
        return {
          success: false,
          error: `Unsupported appointment event type: ${eventType}`,
          retryable: false
        };
      }
    } catch (error) {
      console.error('Error processing appointment event:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        retryable: this.isRetryableError(error)
      };
    }
  }

  /**
   * Handle appointment created event
   */
  private async handleAppointmentCreated(
    appointment: IntakeQAppointment
  ): Promise<AppointmentProcessingResult> {
    try {
      // Log the new appointment
      console.log('Processing appointment creation:', {
        appointmentId: appointment.Id,
        clientId: appointment.ClientId,
        clinicianId: appointment.PractitionerId,
        startTime: appointment.StartDateIso
      });

      // Check if appointment already exists
      const existingAppointment = await this.sheetsService.getAppointment(appointment.Id);
      if (existingAppointment) {
        // Log a warning and return success (idempotent operation)
        console.warn('Appointment already exists, skipping creation:', appointment.Id);
        return {
          success: true,
          details: {
            appointmentId: appointment.Id,
            status: 'already_exists',
            action: 'skipped'
          }
        };
      }

      // Map to appointment record
      const appointmentRecord = this.mapIntakeQToAppointmentRecord(appointment);

      // Add appointment to Google Sheets
      await this.sheetsService.addAppointment(appointmentRecord);

      // Record successful processing
      return {
        success: true,
        details: {
          appointmentId: appointment.Id,
          clientId: appointment.ClientId,
          clinicianId: appointment.PractitionerId,
          startTime: appointment.StartDateIso,
          action: 'created'
        }
      };
    } catch (error) {
      console.error('Error handling appointment creation:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        retryable: this.isRetryableError(error)
      };
    }
  }

  /**
   * Handle appointment updated event
   */
  private async handleAppointmentUpdated(
    appointment: IntakeQAppointment
  ): Promise<AppointmentProcessingResult> {
    try {
      // Log the update
      console.log('Processing appointment update:', {
        appointmentId: appointment.Id,
        clientId: appointment.ClientId,
        clinicianId: appointment.PractitionerId,
        startTime: appointment.StartDateIso
      });

      // Check if appointment exists
      const existingAppointment = await this.sheetsService.getAppointment(appointment.Id);
      if (!existingAppointment) {
        // If appointment doesn't exist, create it
        console.warn('Appointment not found for update, creating instead:', appointment.Id);
        return this.handleAppointmentCreated(appointment);
      }

      // Map to appointment record
      const appointmentRecord = this.mapIntakeQToAppointmentRecord(appointment);

      // Update appointment in Google Sheets
      await this.sheetsService.updateAppointment(appointmentRecord);

      // Record successful processing
      return {
        success: true,
        details: {
          appointmentId: appointment.Id,
          clientId: appointment.ClientId,
          clinicianId: appointment.PractitionerId,
          startTime: appointment.StartDateIso,
          action: 'updated'
        }
      };
    } catch (error) {
      console.error('Error handling appointment update:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        retryable: this.isRetryableError(error)
      };
    }
  }

  /**
   * Handle appointment cancelled event
   */
  private async handleAppointmentCancelled(
    appointment: IntakeQAppointment
  ): Promise<AppointmentProcessingResult> {
    try {
      // Log the cancellation
      console.log('Processing appointment cancellation:', {
        appointmentId: appointment.Id,
        clientId: appointment.ClientId,
        reason: appointment.CancellationReason || 'No reason provided'
      });

      // Check if appointment exists
      const existingAppointment = await this.sheetsService.getAppointment(appointment.Id);
      if (!existingAppointment) {
        // If appointment doesn't exist, log and return success (idempotent)
        console.warn('Appointment not found for cancellation, skipping:', appointment.Id);
        return {
          success: true,
          details: {
            appointmentId: appointment.Id,
            status: 'not_found',
            action: 'skipped'
          }
        };
      }

      // Update the appointment status to cancelled
      const updatedAppointment = {
        ...existingAppointment,
        status: 'cancelled' as const,
        lastUpdated: new Date().toISOString(),
        notes: `Cancelled: ${appointment.CancellationReason || 'No reason provided'}`
      };

      // Update appointment in Google Sheets
      await this.sheetsService.updateAppointment(updatedAppointment);

      // Log cancellation
      await this.sheetsService.addAuditLog({
        timestamp: new Date().toISOString(),
        eventType: AuditEventType.APPOINTMENT_CANCELLED,
        description: `Cancelled appointment ${appointment.Id}`,
        user: 'SYSTEM',
        systemNotes: JSON.stringify({
          appointmentId: appointment.Id,
          clientId: appointment.ClientId,
          reason: appointment.CancellationReason
        })
      });

      // Record successful processing
      return {
        success: true,
        details: {
          appointmentId: appointment.Id,
          clientId: appointment.ClientId,
          reason: appointment.CancellationReason,
          action: 'cancelled'
        }
      };
    } catch (error) {
      console.error('Error handling appointment cancellation:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        retryable: this.isRetryableError(error)
      };
    }
  }

  /**
   * Handle appointment rescheduled event
   */
  private async handleAppointmentRescheduled(
    appointment: IntakeQAppointment
  ): Promise<AppointmentProcessingResult> {
    try {
      // Log the reschedule
      console.log('Processing appointment reschedule:', {
        appointmentId: appointment.Id,
        clientId: appointment.ClientId,
        clinicianId: appointment.PractitionerId,
        newStartTime: appointment.StartDateIso
      });

      // Check if appointment exists
      const existingAppointment = await this.sheetsService.getAppointment(appointment.Id);
      if (!existingAppointment) {
        // If appointment doesn't exist, create it
        console.warn('Appointment not found for reschedule, creating instead:', appointment.Id);
        return this.handleAppointmentCreated(appointment);
      }

      // Map to appointment record
      const appointmentRecord = this.mapIntakeQToAppointmentRecord(appointment);

      // Ensure status is set to scheduled
      appointmentRecord.status = 'scheduled';

      // Update appointment in Google Sheets
      await this.sheetsService.updateAppointment(appointmentRecord);

      // Record successful processing
      return {
        success: true,
        details: {
          appointmentId: appointment.Id,
          clientId: appointment.ClientId,
          clinicianId: appointment.PractitionerId,
          startTime: appointment.StartDateIso,
          action: 'rescheduled'
        }
      };
    } catch (error) {
      console.error('Error handling appointment reschedule:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        retryable: this.isRetryableError(error)
      };
    }
  }

  /**
   * Map IntakeQ appointment to internal appointment record
   */
  private mapIntakeQToAppointmentRecord(
    appointment: IntakeQAppointment
  ): AppointmentRecord {
    // TODO: Implement office assignment logic based on clinician preferences
    // For now, use default office ID
    const defaultOfficeId = 'A-A';

    // Create appointment record
    return {
      appointmentId: appointment.Id,
      clientId: appointment.ClientId.toString(),
      clientName: appointment.ClientName,
      clinicianId: appointment.PractitionerId,
      clinicianName: appointment.PractitionerName,
      officeId: defaultOfficeId,
      sessionType: this.determineSessionType(appointment),
      startTime: appointment.StartDateIso,
      endTime: appointment.EndDateIso,
      status: this.mapAppointmentStatus(appointment.Status),
      lastUpdated: new Date().toISOString(),
      source: 'intakeq',
      requirements: {
        accessibility: false,
        specialFeatures: []
      },
      notes: `Service: ${appointment.ServiceName}`
    };
  }

  /**
   * Determine session type based on appointment data
   */
  private determineSessionType(
    appointment: IntakeQAppointment
  ): 'in-person' | 'telehealth' | 'group' | 'family' {
    // Extract session type from service name
    const serviceName = appointment.ServiceName.toLowerCase();
    
    if (serviceName.includes('telehealth') || serviceName.includes('remote') || serviceName.includes('virtual')) {
      return 'telehealth';
    } else if (serviceName.includes('group')) {
      return 'group';
    } else if (serviceName.includes('family')) {
      return 'family';
    } else {
      return 'in-person';
    }
  }

  /**
   * Map IntakeQ appointment status to internal status
   */
  private mapAppointmentStatus(
    status?: string
  ): 'scheduled' | 'completed' | 'cancelled' | 'rescheduled' {
    if (!status) {
      return 'scheduled';
    }

    const normalizedStatus = status.toLowerCase();
    
    if (normalizedStatus.includes('cancel')) {
      return 'cancelled';
    } else if (normalizedStatus.includes('complete')) {
      return 'completed';
    } else if (normalizedStatus.includes('reschedule')) {
      return 'rescheduled';
    } else {
      return 'scheduled';
    }
  }

  /**
   * Determine if an error is retryable
   */
  private isRetryableError(error: unknown): boolean {
    if (error instanceof Error) {
      // Network errors are typically retryable
      if (error.message.includes('network') || error.message.includes('timeout')) {
        return true;
      }

      // API rate limiting errors are retryable
      if (error.message.includes('rate limit') || error.message.includes('429')) {
        return true;
      }

      // Temporary service errors are retryable
      if (error.message.includes('503') || error.message.includes('temporary')) {
        return true;
      }
    }

    return false;
  }
}

export default AppointmentSync;