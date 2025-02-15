// src/lib/intakeq/appointment-handler.ts

import type { IntakeQWebhookPayload, IntakeQAppointment } from '@/types/webhooks';
import { GoogleSheetsService, AuditEventType } from '@/lib/google/sheets';
import { OfficeAssignmentService } from '@/lib/scheduling/office-assignment';
import type { AppointmentRecord } from '@/types/scheduling';

export class AppointmentHandler {
  constructor(
    private readonly sheetsService: GoogleSheetsService
  ) {}

  async handleAppointment(payload: IntakeQWebhookPayload): Promise<{ success: boolean; error?: string }> {
    try {
      if (!payload.Appointment) {
        throw new Error('No appointment data in payload');
      }

      console.log('Processing appointment:', {
        type: payload.Type,
        appointmentId: payload.Appointment.Id,
        clientId: payload.ClientId,
        startDate: payload.Appointment.StartDateIso,
        duration: payload.Appointment.Duration,
        practitionerId: payload.Appointment.PractitionerId
      });

      switch (payload.Type) {
        case 'Appointment Created':
          return await this.handleNewAppointment(payload.Appointment, payload.ClientId);
        
        case 'Appointment Updated':
        case 'Appointment Rescheduled':
          return await this.handleAppointmentUpdate(payload.Appointment, payload.ClientId);
        
        case 'Appointment Cancelled':
          return await this.handleAppointmentCancellation(payload.Appointment, payload.ClientId);
        
        default:
          throw new Error(`Unsupported appointment event type: ${payload.Type}`);
      }
    } catch (error) {
      console.error('Error handling appointment:', error);
      
      await this.sheetsService.addAuditLog({
        timestamp: new Date().toISOString(),
        eventType: AuditEventType.SYSTEM_ERROR,
        description: `Error processing ${payload.Type}`,
        user: 'SYSTEM',
        systemNotes: error instanceof Error ? error.message : 'Unknown error'
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }

  private async handleNewAppointment(appointment: IntakeQAppointment, clientId: string | number): Promise<{ success: boolean; error?: string }> {
    try {
      console.log('Handling new appointment:', {
        appointmentId: appointment.Id,
        clientId,
        startDate: appointment.StartDateIso,
        practitionerId: appointment.PractitionerId
      });

      // 1. Get required data
      const [offices, rules, clinicians] = await Promise.all([
        this.sheetsService.getOffices(),
        this.sheetsService.getAssignmentRules(),
        this.sheetsService.getClinicians()
      ]);

      console.log('Data fetched:', {
        officeCount: offices.length,
        ruleCount: rules.length,
        clinicianCount: clinicians.length,
        practitionerIds: clinicians.map(c => c.intakeQPractitionerId)
      });

      // 2. Find matching clinician
      const clinician = clinicians.find(c => c.intakeQPractitionerId === appointment.PractitionerId);
      if (!clinician) {
        throw new Error(`Clinician ${appointment.PractitionerId} not found`);
      }

      console.log('Found clinician:', {
        clinicianId: clinician.clinicianId,
        name: clinician.name,
        intakeQId: clinician.intakeQPractitionerId
      });

      // 2. Create office assignment service
      const assignmentService = new OfficeAssignmentService(
        offices,
        rules,
        clinicians
      );

      // 3. Convert to scheduling request
      const request = {
        clientId: clientId.toString(),
        clinicianId: clinician.clinicianId, // Use internal ID
        dateTime: appointment.StartDateIso,
        duration: appointment.Duration,
        sessionType: this.determineSessionType(appointment.ServiceName),
        requirements: {
          accessibility: false
        }
      };

      console.log('Created scheduling request:', request);

      // 4. Find optimal office
      const assignmentResult = await assignmentService.findOptimalOffice(request);
      console.log('Office assignment result:', assignmentResult);

      if (!assignmentResult.success) {
        throw new Error(assignmentResult.error || 'Failed to find suitable office');
      }

      // 5. Create appointment record
      const appointmentRecord: AppointmentRecord = {
        appointmentId: appointment.Id,
        clientId: clientId.toString(),
        clinicianId: clinician.clinicianId, // Use internal ID
        officeId: assignmentResult.officeId!,
        sessionType: this.determineSessionType(appointment.ServiceName),
        startTime: appointment.StartDateIso,
        endTime: appointment.EndDateIso,
        status: 'scheduled',
        lastUpdated: new Date().toISOString(),
        source: 'intakeq',
        requirements: {
          accessibility: false,
          specialFeatures: []
        },
        notes: assignmentResult.notes
      };

      console.log('Created appointment record:', appointmentRecord);

      // 6. Store the appointment
      await this.sheetsService.addAppointment(appointmentRecord);

      // 7. Log success
      await this.sheetsService.addAuditLog({
        timestamp: new Date().toISOString(),
        eventType: AuditEventType.APPOINTMENT_CREATED,
        description: `Created appointment ${appointment.Id}`,
        user: 'SYSTEM',
        systemNotes: JSON.stringify({
          appointmentId: appointment.Id,
          officeId: assignmentResult.officeId,
          clientId: clientId
        })
      });

      return { success: true };
    } catch (error) {
      console.error('Error creating appointment:', error);
      throw error;
    }
  }

  private async handleAppointmentUpdate(appointment: IntakeQAppointment, clientId: string | number): Promise<{ success: boolean; error?: string }> {
    try {
      console.log('Handling appointment update:', {
        appointmentId: appointment.Id,
        clientId,
        startDate: appointment.StartDateIso
      });

      // Similar to handleNewAppointment but with update logic
      // For now, just log and return success
      return { success: true };
    } catch (error) {
      console.error('Error updating appointment:', error);
      throw error;
    }
  }

  private async handleAppointmentCancellation(appointment: IntakeQAppointment, clientId: string | number): Promise<{ success: boolean; error?: string }> {
    try {
      console.log('Handling appointment cancellation:', {
        appointmentId: appointment.Id,
        clientId,
        startDate: appointment.StartDateIso
      });

      await this.sheetsService.updateAppointment({
        appointmentId: appointment.Id,
        clientId: clientId.toString(),
        clinicianId: appointment.PractitionerId,
        officeId: '', // Keep existing office
        sessionType: this.determineSessionType(appointment.ServiceName),
        startTime: appointment.StartDateIso,
        endTime: appointment.EndDateIso,
        status: 'cancelled',
        lastUpdated: new Date().toISOString(),
        source: 'intakeq'
      });

      await this.sheetsService.addAuditLog({
        timestamp: new Date().toISOString(),
        eventType: AuditEventType.APPOINTMENT_CANCELLED,
        description: `Cancelled appointment ${appointment.Id}`,
        user: 'SYSTEM',
        systemNotes: JSON.stringify({
          appointmentId: appointment.Id,
          clientId: clientId,
          reason: appointment.CancellationReason
        })
      });

      return { success: true };
    } catch (error) {
      console.error('Error cancelling appointment:', error);
      throw error;
    }
  }

  private determineSessionType(serviceName: string): 'in-person' | 'telehealth' | 'group' | 'family' {
    const name = serviceName.toLowerCase();
    if (name.includes('telehealth')) return 'telehealth';
    if (name.includes('group')) return 'group';
    if (name.includes('family') || name.includes('relationship')) return 'family';
    return 'in-person';
  }
}