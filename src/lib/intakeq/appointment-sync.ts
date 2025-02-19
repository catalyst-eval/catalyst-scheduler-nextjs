// src/lib/intakeq/appointment-sync.ts

import type { 
  IntakeQAppointment, 
  IntakeQWebhookPayload,
  WebhookResponse 
} from '@/types/webhooks';
import type { GoogleSheetsService } from '@/lib/google/sheets';
import type { EmailService } from '@/lib/email/service';
import type { IntakeQService } from './service';
import type { 
  SchedulingRequest,
  AppointmentRecord,
  SessionType,
  AlertSeverity,
  StandardOfficeId
} from '@/types/scheduling';
import type { 
  ValidationResponse, 
  AppointmentConflict,
  ApiResponse
} from '@/types/api';
import type { ClientPreference } from '@/types/sheets';
import { AuditEventType } from '@/lib/google/sheets';
import { OfficeAssignmentService } from '../scheduling/office-assignment';
import { EmailTemplates } from '../email/templates';
import { RecipientManagementService } from '@/lib/email/recipients';
import { 
  transformIntakeQAppointment, 
  determineSessionType,
  EmailPriority
} from '../transformations/appointment-types';

export class AppointmentSyncHandler {
  private readonly recipientService: RecipientManagementService;

  constructor(
    private readonly sheetsService: GoogleSheetsService,
    private readonly intakeQService: IntakeQService,
    private readonly emailService: EmailService
  ) {
    this.recipientService = new RecipientManagementService(sheetsService);
  }

  /**
   * Process appointment webhook events
   */
  async processAppointmentEvent(
    payload: IntakeQWebhookPayload
  ): Promise<WebhookResponse> {
    if (!payload.Appointment) {
      return { 
        success: false, 
        error: 'Missing appointment data' 
      };
    }

    try {
      // Log webhook receipt
      await this.sheetsService.addAuditLog({
        timestamp: new Date().toISOString(),
        eventType: AuditEventType.WEBHOOK_RECEIVED,
        description: `Received ${payload.Type} webhook`,
        user: 'INTAKEQ_WEBHOOK',
        systemNotes: JSON.stringify({
          appointmentId: payload.Appointment.Id,
          type: payload.Type,
          clientId: payload.ClientId
        })
      });

      switch (payload.Type) {
        case 'AppointmentCreated':
        case 'Appointment Created':
          if (payload.Appointment.RecurrencePattern) {
            return await this.handleRecurringAppointment(
              payload.Appointment,
              payload.Appointment.RecurrencePattern
            );
          }
          return await this.handleNewAppointment(payload.Appointment);
        
        case 'AppointmentUpdated':
        case 'Appointment Updated':
        case 'AppointmentRescheduled':
        case 'Appointment Rescheduled':
          return await this.handleAppointmentUpdate(payload.Appointment);
          
        case 'AppointmentCancelled':
        case 'Appointment Cancelled':
          return await this.handleAppointmentCancellation(payload.Appointment);
          
        default:
          return {
            success: false,
            error: `Unsupported event type: ${payload.Type}`
          };
      }
    } catch (error) {
      console.error('Appointment processing error:', error);
      
      // Log the error
      await this.sheetsService.addAuditLog({
        timestamp: new Date().toISOString(),
        eventType: AuditEventType.SYSTEM_ERROR,
        description: `Error processing appointment ${payload.Appointment.Id}`,
        user: 'SYSTEM',
        systemNotes: error instanceof Error ? error.message : 'Unknown error'
      });

      return {
        success: false,
        error: 'Appointment processing failed'
      };
    }
  }

  private async handleNewAppointment(
    appointment: IntakeQAppointment
  ): Promise<WebhookResponse> {
    try {
      // Convert to scheduling request format
      const request = await this.convertToSchedulingRequest(appointment);
      
      // Validate scheduling
      const validationResult = await this.validateScheduleInRealTime(request);
      if (!validationResult.isValid) {
        return {
          success: false,
          error: `Scheduling validation failed: ${validationResult.conflicts.map(c => c.description).join(', ')}`,
          details: {
            appointmentId: appointment.Id,
            action: 'validation-failed',
            conflicts: validationResult.conflicts
          }
        };
      }

      // Find optimal office
      const [offices, rules, clinicians] = await Promise.all([
        this.sheetsService.getOffices(),
        this.sheetsService.getAssignmentRules(),
        this.sheetsService.getClinicians()
      ]);

      const clientPreference = await this.getClientPreference(appointment.ClientId.toString());
      
      const assignmentService = new OfficeAssignmentService(
        offices,
        rules,
        clinicians,
        clientPreference
      );

      const assignmentResult = await assignmentService.findOptimalOffice(request);
      
      if (!assignmentResult.success) {
        throw new Error(assignmentResult.error || 'Failed to find suitable office');
      }

      // Log the assignment
      await this.sheetsService.addAuditLog({
        timestamp: new Date().toISOString(),
        eventType: AuditEventType.APPOINTMENT_CREATED,
        description: `Assigned office ${assignmentResult.officeId} for appointment ${appointment.Id}`,
        user: 'SYSTEM',
        systemNotes: JSON.stringify({
          appointmentId: appointment.Id,
          officeId: assignmentResult.officeId,
          clientId: appointment.ClientId
        })
      });

      // Send notifications
      await this.sendNotifications({
        type: 'new',
        appointment,
        officeId: assignmentResult.officeId!
      });

      return {
        success: true,
        details: {
          appointmentId: appointment.Id,
          officeId: assignmentResult.officeId,
          action: 'created'
        }
      };
    } catch (error) {
      console.error('Error handling new appointment:', error);
      throw error;
    }
  }

  private async handleAppointmentUpdate(
    appointment: IntakeQAppointment
  ): Promise<WebhookResponse> {
    try {
      const request = await this.convertToSchedulingRequest(appointment);
      
      // Validate scheduling
      const validationResult = await this.validateScheduleInRealTime(request);
      if (!validationResult.isValid) {
        return {
          success: false,
          error: `Scheduling validation failed: ${validationResult.conflicts.map(c => c.description).join(', ')}`,
          details: {
            appointmentId: appointment.Id,
            action: 'validation-failed',
            conflicts: validationResult.conflicts
          }
        };
      }

      // Find optimal office for updated appointment
      const [offices, rules, clinicians] = await Promise.all([
        this.sheetsService.getOffices(),
        this.sheetsService.getAssignmentRules(),
        this.sheetsService.getClinicians()
      ]);

      const clientPreference = await this.getClientPreference(appointment.ClientId.toString());
      
      const assignmentService = new OfficeAssignmentService(
        offices,
        rules,
        clinicians,
        clientPreference
      );

      const assignmentResult = await assignmentService.findOptimalOffice(request);
      
      if (!assignmentResult.success) {
        throw new Error(assignmentResult.error || 'Failed to find suitable office');
      }

      // Log the update
      await this.sheetsService.addAuditLog({
        timestamp: new Date().toISOString(),
        eventType: AuditEventType.APPOINTMENT_UPDATED,
        description: `Updated office assignment for appointment ${appointment.Id}`,
        user: 'SYSTEM',
        newValue: JSON.stringify({
          appointmentId: appointment.Id,
          officeId: assignmentResult.officeId,
          clientId: appointment.ClientId
        })
      });

      // Send notifications
      await this.sendNotifications({
        type: 'update',
        appointment,
        officeId: assignmentResult.officeId!
      });

      return {
        success: true,
        details: {
          appointmentId: appointment.Id,
          officeId: assignmentResult.officeId,
          action: 'updated'
        }
      };
    } catch (error) {
      console.error('Error handling appointment update:', error);
      throw error;
    }
  }

  private async handleAppointmentCancellation(
    appointment: IntakeQAppointment
  ): Promise<WebhookResponse> {
    try {
      // Log cancellation
      await this.sheetsService.addAuditLog({
        timestamp: new Date().toISOString(),
        eventType: AuditEventType.APPOINTMENT_CANCELLED,
        description: `Cancelled appointment ${appointment.Id}`,
        user: 'SYSTEM',
        systemNotes: JSON.stringify({
          appointmentId: appointment.Id,
          clientId: appointment.ClientId,
          reason: appointment.CancellationReason || 'No reason provided'
        })
      });

      // Send notifications
      await this.sendNotifications({
        type: 'cancellation',
        appointment
      });

      return {
        success: true,
        details: {
          appointmentId: appointment.Id,
          action: 'cancelled'
        }
      };
    } catch (error) {
      console.error('Error handling appointment cancellation:', error);
      throw error;
    }
  }

  private async handleRecurringAppointment(
    appointment: IntakeQAppointment,
    recurrencePattern: {
      frequency: 'weekly' | 'biweekly' | 'monthly';
      occurrences: number;
      endDate?: string;
    }
  ): Promise<WebhookResponse> {
    try {
      let currentDate = new Date(appointment.StartDateIso);
      const endDate = recurrencePattern.endDate 
        ? new Date(recurrencePattern.endDate)
        : null;
      
      let occurrenceCount = 0;
      const results: WebhookResponse[] = [];
      
      while (
        occurrenceCount < recurrencePattern.occurrences && 
        (!endDate || currentDate <= endDate)
      ) {
        // Create appointment instance
        const instanceDate = new Date(currentDate);
        const appointmentInstance = {
          ...appointment,
          Id: `${appointment.Id}-${occurrenceCount + 1}`,
          StartDateIso: instanceDate.toISOString(),
          EndDateIso: new Date(
            instanceDate.getTime() + (appointment.Duration * 60000)
          ).toISOString()
        };

        // Process individual instance
        const result = await this.handleNewAppointment(appointmentInstance);
        results.push(result);

        if (!result.success) {
          break;
        }

        // Advance to next occurrence
        switch (recurrencePattern.frequency) {
          case 'weekly':
            currentDate.setDate(currentDate.getDate() + 7);
            break;
          case 'biweekly':
            currentDate.setDate(currentDate.getDate() + 14);
            break;
          case 'monthly':
            currentDate.setMonth(currentDate.getMonth() + 1);
            break;
        }

        occurrenceCount++;
      }

      const failedResults = results.filter(r => !r.success);
      
      if (failedResults.length > 0) {
        return {
          success: false,
          error: 'Some recurring appointments failed to schedule',
          details: {
            appointmentId: appointment.Id,
            action: 'recurring-partial',
            successful: results.length - failedResults.length,
            failed: failedResults.length,
            failures: failedResults
          }
        };
      }

      return {
        success: true,
        details: {
          appointmentId: appointment.Id,
          action: 'recurring-created',
          occurrences: results.length
        }
      };
    } catch (error) {
      console.error('Error handling recurring appointment:', error);
      throw error;
    }
  }

  // Part of appointment-sync.ts

// Part of appointment-sync.ts

private async sendNotifications(options: {
  type: 'new' | 'update' | 'cancellation';
  appointment: IntakeQAppointment;
  officeId?: StandardOfficeId;
}): Promise<void> {
  const { type, appointment, officeId } = options;

  // Get recipients based on notification type
  const recipients = await this.emailService.getClinicianRecipients();

  // Transform the appointment
  const transformedAppointment = transformIntakeQAppointment(appointment);

  // Create appropriate template
  const standardizeOfficeId = (id?: string): StandardOfficeId => {
    if (!id) return 'A-a' as StandardOfficeId;
    const match = id.match(/^([A-Z])-([a-z])$/);
    if (match) return id as StandardOfficeId;
    return 'A-a' as StandardOfficeId;
  };
  
  const template = EmailTemplates.dailySchedule({
    date: new Date(appointment.StartDateIso).toISOString().split('T')[0],
    appointments: [transformedAppointment],
    alerts: [{
      type: 'appointment',
      message: `${type} appointment: ${appointment.ClientName}`,
      severity: type === 'new' ? 'low' : 'high'
    }]
  });
}

  public async validateScheduleInRealTime(
    request: SchedulingRequest
  ): Promise<ValidationResponse> {
    try {
      // Get existing appointments for the date from IntakeQ
      const requestDate = new Date(request.dateTime);
      const startOfDay = new Date(requestDate);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(requestDate);
      endOfDay.setHours(23, 59, 59, 999);

      const existingAppointments = await this.intakeQService.getAppointments(
        startOfDay.toISOString(),
        endOfDay.toISOString()
      );

      const conflicts: AppointmentConflict[] = [];

      // Check clinician availability
      const clinicianBookings = existingAppointments.filter(
        booking => booking.PractitionerId === request.clinicianId
      );

      const requestStart = new Date(request.dateTime);
      const requestEnd = new Date(
        requestStart.getTime() + (request.duration * 60000)
      );

      // Check for conflicts
      for (const booking of clinicianBookings) {
        const bookingStart = new Date(booking.StartDateIso);
        const bookingEnd = new Date(booking.EndDateIso);

        if (requestStart < bookingEnd && requestEnd > bookingStart) {
          conflicts.push({
            type: 'double-booking',
            description: 'Clinician is already booked during this time',
            severity: 'high',
            appointmentIds: [booking.Id]
          });
        }
      }

      return {
        isValid: conflicts.length === 0,
        conflicts
      };
    } catch (error) {
      console.error('Validation error:', error);
      throw error;
    }
  }

  private async getClientPreference(
    clientId: string
  ): Promise<ClientPreference | undefined> {
    const preferences = await this.sheetsService.getClientPreferences();
    return preferences.find(pref => pref.clientId === clientId);
  }

  private async convertToSchedulingRequest(
    appointment: IntakeQAppointment
  ): Promise<SchedulingRequest> {
    try {
      // Find clinician by IntakeQ ID
      const clinicians = await this.sheetsService.getClinicians();
      const clinician = clinicians.find(c => 
        c.intakeQPractitionerId === appointment.PractitionerId
      );

      if (!clinician) {
        throw new Error(`No clinician found for IntakeQ ID: ${appointment.PractitionerId}`);
      }

      // Get client preferences to determine requirements
      const clientPrefs = await this.getClientPreference(appointment.ClientId.toString());
      
      // Set base requirements from client preferences
      const mobilityNeeds = clientPrefs?.mobilityNeeds || [];
      const sensoryPrefs = clientPrefs?.sensoryPreferences || [];
      const physicalNeeds = clientPrefs?.physicalNeeds || [];

      const standardizeOfficeId = (officeId?: string): StandardOfficeId | undefined => {
        if (!officeId) return undefined;
        const match = officeId.match(/^([A-Z])-([a-z])$/);
        if (match) return officeId as StandardOfficeId;
        return undefined;
      };
      
      const requirements = {
        accessibility: Array.isArray(mobilityNeeds) && mobilityNeeds.length > 0,
        specialFeatures: [
          ...(Array.isArray(sensoryPrefs) ? sensoryPrefs : []),
          ...(Array.isArray(physicalNeeds) ? physicalNeeds : [])
        ],
        roomPreference: standardizeOfficeId(clientPrefs?.assignedOffice)
      };

      return {
        clientId: appointment.ClientId.toString(),
        clinicianId: clinician.clinicianId,
        dateTime: appointment.StartDateIso,
        duration: appointment.Duration,
        sessionType: this.determineSessionType(appointment),
        requirements
      };
    } catch (error) {
      // Log conversion error
      await this.sheetsService.addAuditLog({
        timestamp: new Date().toISOString(),
        eventType: AuditEventType.SYSTEM_ERROR,
        description: `Error converting IntakeQ appointment ${appointment.Id}`,
        user: 'SYSTEM',
        systemNotes: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  private determineSessionType(
    appointment: IntakeQAppointment
  ): 'in-person' | 'telehealth' | 'group' | 'family' {
    const serviceName = appointment.ServiceName.toLowerCase();
    
    // Map commonly used telehealth terms
    if (serviceName.match(/tele(health|therapy|med|session)|virtual|remote|video/)) {
      return 'telehealth';
    }
  
    // Map group therapy variations
    if (serviceName.match(/group|workshop|class|seminar/)) {
      return 'group';
    }
  
    // Map family therapy variations
    if (serviceName.match(/family|couples|relationship|parental|parent-child/)) {
      return 'family';
    }
  
    // Check service metadata if available
    if (appointment.ServiceId) {
      // Store common service IDs for quick lookup
      const TELEHEALTH_SERVICES = ['64a319db9173cb32157ea065', '64a319db9173cb32157ea066'];
      const GROUP_SERVICES = ['64a319db9173cb32157ea067'];
      const FAMILY_SERVICES = ['64a319db9173cb32157ea068'];
  
      if (TELEHEALTH_SERVICES.includes(appointment.ServiceId)) {
        return 'telehealth';
      }
      if (GROUP_SERVICES.includes(appointment.ServiceId)) {
        return 'group';
      }
      if (FAMILY_SERVICES.includes(appointment.ServiceId)) {
        return 'family';
      }
    }
  
    // Default to in-person if no other matches
    return 'in-person';
  }
}