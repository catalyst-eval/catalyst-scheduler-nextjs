import type { IntakeQWebhookPayload, IntakeQAppointment } from '@/types/webhooks';
import { GoogleSheetsService, AuditEventType } from '@/lib/google/sheets';
import { OfficeAssignmentService } from '@/lib/scheduling/office-assignment';
import type { AppointmentRecord } from '@/types/scheduling';
import type { StandardOfficeId } from '@/types/offices';

export class AppointmentHandler {
  constructor(
    private readonly sheetsService: GoogleSheetsService
  ) {}

  // src/lib/intakeq/appointment-handler.ts
async handleAppointment(payload: IntakeQWebhookPayload): Promise<{ success: boolean; error?: string }> {
  try {
    if (!payload.Appointment) {
      throw new Error('No appointment data in payload');
    }

    console.log('Processing appointment:', {
      type: payload.Type || payload.EventType, // Check both Type and EventType
      appointmentId: payload.Appointment.Id,
      clientId: payload.ClientId,
      startDate: payload.Appointment.StartDateIso,
      duration: payload.Appointment.Duration,
      practitionerId: payload.Appointment.PractitionerId
    });

    switch (payload.Type || payload.EventType) { // Check both Type and EventType
      case 'AppointmentCreated':
      case 'Appointment Created':
        return await this.handleNewAppointment(payload.Appointment, payload.ClientId);
      
      case 'AppointmentUpdated':
      case 'Appointment Updated':
      case 'AppointmentRescheduled':
      case 'Appointment Rescheduled':
        return await this.handleAppointmentUpdate(payload.Appointment, payload.ClientId);
      
      case 'AppointmentCancelled':
      case 'Appointment Cancelled':
      case 'AppointmentCanceled':
      case 'Appointment Canceled':
        return await this.handleAppointmentCancellation(payload.Appointment, payload.ClientId);
      
      case 'AppointmentDeleted':
      case 'Appointment Deleted':
        return await this.handleAppointmentDeletion(payload.Appointment, payload.ClientId);
      
      default:
        throw new Error(`Unsupported appointment event type: ${payload.Type || payload.EventType}`);
    }
  } catch (error) {
    console.error('Error handling appointment:', error);
    
    await this.sheetsService.addAuditLog({
      timestamp: new Date().toISOString(),
      eventType: AuditEventType.SYSTEM_ERROR,
      description: `Error processing ${payload.Type || payload.EventType}`,
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
    // Enhanced logging for appointment data
    console.log('Processing new appointment:', {
      appointmentId: appointment.Id,
      clientId,
      clientName: appointment.ClientName,
      startDate: appointment.StartDateIso,
      practitionerId: appointment.PractitionerId,
      serviceName: appointment.ServiceName
    });

    // 1. Get required data
    const [offices, rules, clinicians] = await Promise.all([
      this.sheetsService.getOffices(),
      this.sheetsService.getAssignmentRules(),
      this.sheetsService.getClinicians()
    ]);

    // Enhanced clinician lookup logging
    console.log('Clinician lookup:', {
      searchingFor: appointment.PractitionerId,
      availableClinicians: clinicians.map(c => ({
        id: c.clinicianId,
        name: c.name,
        intakeQId: c.intakeQPractitionerId
      }))
    });

    // Find matching clinician with exact match
    const matchedClinician = clinicians.find(c => 
      c.intakeQPractitionerId && 
      c.intakeQPractitionerId.trim() === appointment.PractitionerId.trim()
    );

    if (!matchedClinician) {
      const error = `No clinician found matching IntakeQ ID: ${appointment.PractitionerId}`;
      console.error(error, {
        appointmentId: appointment.Id,
        practitionerName: appointment.PractitionerName,
        allClinicianIds: clinicians.map(c => c.intakeQPractitionerId)
      });
      throw new Error(error);
    }

    console.log('Found matching clinician:', {
      clinicianId: matchedClinician.clinicianId,
      name: matchedClinician.name,
      intakeQId: matchedClinician.intakeQPractitionerId
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
      clinicianId: matchedClinician.clinicianId,
      dateTime: appointment.StartDateIso,
      duration: appointment.Duration,
      sessionType: this.determineSessionType(appointment.ServiceName),
      requirements: {
        accessibility: false
      }
    };

    // Rest of the function remains the same, but using matchedClinician instead of clinician
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
        clientName: appointment.ClientName,  // Add this
        clinicianId: matchedClinician.clinicianId,
        clinicianName: matchedClinician.name,
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
        startDate: appointment.StartDateIso,
        oldTime: null, // Will be populated below
        newTime: appointment.StartDateIso
      });
  
      // Get existing appointment data
      const existingAppointment = await this.sheetsService.getAppointment(appointment.Id);
      if (!existingAppointment) {
        console.log('No existing appointment found, creating new');
        return await this.handleNewAppointment(appointment, clientId);
      }
  
      console.log('Found existing appointment:', {
        old: {
          startTime: existingAppointment.startTime,
          endTime: existingAppointment.endTime,
          officeId: existingAppointment.officeId
        },
        new: {
          startTime: appointment.StartDateIso,
          endTime: appointment.EndDateIso
        }
      });
  
      // 1. Get required data to check for new office assignment
      const [offices, rules, clinicians] = await Promise.all([
        this.sheetsService.getOffices(),
        this.sheetsService.getAssignmentRules(),
        this.sheetsService.getClinicians()
      ]);
  
      // 2. Find matching clinician
      const clinician = clinicians.find(c => c.intakeQPractitionerId === appointment.PractitionerId);
      if (!clinician) {
        throw new Error(`Clinician ${appointment.PractitionerId} not found`);
      }
  
      // 3. Create updated appointment record
      const updatedAppointment: AppointmentRecord = {
        ...existingAppointment,
        startTime: appointment.StartDateIso,
        endTime: appointment.EndDateIso,
        lastUpdated: new Date().toISOString(),
        sessionType: this.determineSessionType(appointment.ServiceName),
        clientName: appointment.ClientName,
        clinicianName: clinician.name
      };
  
      // 4. Update in sheets
      await this.sheetsService.updateAppointment(updatedAppointment);
  
      // 5. Log the update
      await this.sheetsService.addAuditLog({
        timestamp: new Date().toISOString(),
        eventType: AuditEventType.APPOINTMENT_UPDATED,
        description: `Updated appointment ${appointment.Id}`,
        user: 'SYSTEM',
        previousValue: JSON.stringify({
          startTime: existingAppointment.startTime,
          endTime: existingAppointment.endTime
        }),
        newValue: JSON.stringify({
          startTime: appointment.StartDateIso,
          endTime: appointment.EndDateIso
        }),
        systemNotes: `Updated time from ${existingAppointment.startTime} to ${appointment.StartDateIso}`
      });
  
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
        clientName: appointment.ClientName,  // Add this
        clinicianId: appointment.PractitionerId,
        clinicianName: appointment.PractitionerName,  // Add this
        officeId: 'B-1' as StandardOfficeId, // Default office ID that will be updated later
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

  private async handleAppointmentDeletion(appointment: IntakeQAppointment, clientId: number): Promise<{ success: boolean; error?: string; appointmentId?: string; action?: string }> {
    try {
      // Get existing appointment
      const appointmentDate = new Date(appointment.StartDateIso).toISOString().split('T')[0];
      const existingAppointments = await this.sheetsService.getAppointments(
        `${appointmentDate}T00:00:00Z`,
        `${appointmentDate}T23:59:59Z`
      );

      const existingAppointment = existingAppointments.find(
        appt => appt.appointmentId === appointment.Id
      );

      if (!existingAppointment) {
        return {
          success: false,
          error: 'Appointment not found',
          appointmentId: appointment.Id,
          action: 'deletion-failed'
        };
      }

      // Delete appointment from sheets
      await this.sheetsService.deleteAppointment(existingAppointment.appointmentId);

      // Log deletion
      await this.sheetsService.addAuditLog({
        timestamp: new Date().toISOString(),
        eventType: AuditEventType.APPOINTMENT_DELETED,
        description: `Deleted appointment ${appointment.Id}`,
        user: 'SYSTEM',
        previousValue: JSON.stringify(existingAppointment)
      });

      return {
        success: true,
        appointmentId: appointment.Id,
        action: 'deleted'
      };
    } catch (error) {
      console.error('Error handling appointment deletion:', error);
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