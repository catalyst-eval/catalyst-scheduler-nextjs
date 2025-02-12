// src/lib/intakeq/appointment-sync.ts

import type { 
    IntakeQAppointment, 
    IntakeQWebhookPayload 
} from '@/types/webhooks';
import type { GoogleSheetsService } from '@/lib/google/sheets';
import type { 
    SchedulingRequest,
    AppointmentRecord
} from '../../types/scheduling';
import type { ClientPreference } from '@/types/sheets';
import { AuditEventType } from '@/lib/google/sheets';
import { OfficeAssignmentService } from '../scheduling/office-assignment';
import { DailySummaryService } from '../scheduling/daily-summary-service';
import { initializeEmailService } from '@/lib/email/config';
import { EmailTemplates } from '../email/templates';
import { RecipientManagementService } from '@/lib/email/recipients';
  
  interface AppointmentProcessingResult {
    success: boolean;
    error?: string;
    appointmentId?: string;
    action?: string;
  }
  
  export class AppointmentSyncHandler {
    constructor(private readonly sheetsService: GoogleSheetsService) {}
  
    /**
     * Process appointment webhook events
     */
    async processAppointmentEvent(
      payload: IntakeQWebhookPayload
    ): Promise<AppointmentProcessingResult> {
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
            case 'Appointment Created':
              if (payload.Appointment.RecurrencePattern) {
                return await this.handleRecurringAppointment(
                  payload.Appointment,
                  payload.Appointment.RecurrencePattern
                );
              }
              return await this.handleNewAppointment(payload.Appointment);
            
            case 'Appointment Updated':
            case 'Appointment Rescheduled':
              return await this.handleAppointmentUpdate(payload.Appointment);
              
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
  
    /**
     * Handle new appointment creation
     */
    private async handleNewAppointment(
      appointment: IntakeQAppointment
    ): Promise<AppointmentProcessingResult> {
      try {
        // Convert to scheduling request format
        const request = this.convertToSchedulingRequest(appointment);

        // Log the creation attempt
        await this.sheetsService.addAuditLog({
          timestamp: new Date().toISOString(),
          eventType: AuditEventType.APPOINTMENT_CREATED,
          description: `Processing new appointment ${appointment.Id}`,
          user: 'SYSTEM',
          systemNotes: JSON.stringify(request)
        });

        // Check for existing appointments on the same day
        const appointmentDate = new Date(appointment.StartDateIso).toISOString().split('T')[0];
        const existingAppointments = await this.sheetsService.getAppointments(
          `${appointmentDate}T00:00:00Z`,
          `${appointmentDate}T23:59:59Z`
        );

        // Validate schedule
        const validationResult = await this.validateScheduleInRealTime(request, existingAppointments);
        if (!validationResult.isValid) {
          return {
            success: false,
            error: `Scheduling validation failed: ${validationResult.conflicts.map(c => c.description).join(', ')}`,
            appointmentId: appointment.Id,
            action: 'validation-failed'
          };
        }

        // Create office assignment service instance
        const assignmentService = new OfficeAssignmentService(
          await this.sheetsService.getOffices(),
          await this.sheetsService.getAssignmentRules(),
          await this.getClientPreference(appointment.ClientId.toString()),
          this.createBookingsMap(existingAppointments)
        );

        // Find optimal office
        const assignmentResult = await assignmentService.findOptimalOffice(request);
        
        if (!assignmentResult.success) {
          return {
            success: false,
            error: assignmentResult.error || 'Failed to find suitable office',
            appointmentId: appointment.Id,
            action: 'office-assignment-failed'
          };
        }

        // Create appointment record
        const appointmentRecord: AppointmentRecord = {
          appointmentId: appointment.Id,
          clientId: appointment.ClientId.toString(),
          clinicianId: appointment.PractitionerId,
          officeId: assignmentResult.officeId!,
          sessionType: this.determineSessionType(appointment),
          startTime: appointment.StartDateIso,
          endTime: appointment.EndDateIso,
          status: 'scheduled',
          lastUpdated: new Date().toISOString(),
          source: 'intakeq',
          requirements: {
            accessibility: request.requirements?.accessibility ?? false,
            specialFeatures: request.requirements?.specialFeatures ?? []
          },
          notes: assignmentResult.notes
        };

        // Store appointment
        await this.sheetsService.addAppointment(appointmentRecord);

        // After storing the appointment, send notifications
        const emailService = await initializeEmailService(this.sheetsService);
        const recipientService = new RecipientManagementService(this.sheetsService);
        
        // Get daily summary using dedicated service
        const summaryService = new DailySummaryService(
          await this.sheetsService.getOffices(),
          [...existingAppointments, appointmentRecord]
        );
        const summary = await summaryService.generateDailySummary(
          new Date(appointment.StartDateIso).toISOString().split('T')[0]
        );

        // Send updated schedule
        const recipients = await recipientService.getDailyScheduleRecipients();
        const template = EmailTemplates.dailySchedule(summary);
        await emailService.sendEmail(recipients, template, {
          type: 'schedule',
          priority: 'normal',
          retryCount: 3
        });

        return {
          success: true,
          appointmentId: appointment.Id,
          action: 'created'
        };
      } catch (error) {
        console.error('Error handling new appointment:', error);
        
        // Log the error
        await this.sheetsService.addAuditLog({
          timestamp: new Date().toISOString(),
          eventType: AuditEventType.SYSTEM_ERROR,
          description: `Error processing appointment ${appointment.Id}`,
          user: 'SYSTEM',
          systemNotes: error instanceof Error ? error.message : 'Unknown error'
        });

        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error occurred',
          appointmentId: appointment.Id,
          action: 'error'
        };
      }
    }
  
    /**
     * Handle appointment updates
     */
    private async handleAppointmentUpdate(
      appointment: IntakeQAppointment
    ): Promise<AppointmentProcessingResult> {
      try {
        // Convert to scheduling request format
        const request = this.convertToSchedulingRequest(appointment);
  
        // Log the update attempt
        await this.sheetsService.addAuditLog({
          timestamp: new Date().toISOString(),
          eventType: AuditEventType.APPOINTMENT_UPDATED,
          description: `Processing update for appointment ${appointment.Id}`,
          user: 'SYSTEM',
          systemNotes: JSON.stringify(request)
        });
  
        // Get existing appointment
        const appointmentDate = new Date(appointment.StartDateIso).toISOString().split('T')[0];
        const existingAppointments = await this.sheetsService.getAppointments(
          `${appointmentDate}T00:00:00Z`,
          `${appointmentDate}T23:59:59Z`
        );
        
        // Validate schedule
    const validationResult = await this.validateScheduleInRealTime(request, existingAppointments);
    if (!validationResult.isValid) {
      throw new Error(`Scheduling validation failed: ${validationResult.conflicts.map(c => c.description).join(', ')}`);
    }

        const existingAppointment = existingAppointments.find(
          appt => appt.appointmentId === appointment.Id
        );

        if (!existingAppointment) {
          // If appointment doesn't exist, treat as new
          return this.handleNewAppointment(appointment);
        }

        // Check if this is a time change
        const isTimeChange = 
          existingAppointment.startTime !== appointment.StartDateIso ||
          existingAppointment.endTime !== appointment.EndDateIso;

        if (isTimeChange) {
          // Get all appointments for the new time slot
          const newDate = new Date(appointment.StartDateIso).toISOString().split('T')[0];
          const newTimeAppointments = await this.sheetsService.getAppointments(
            `${newDate}T00:00:00Z`,
            `${newDate}T23:59:59Z`
          );

          // Validate new time slot
          const validationResult = await this.validateScheduleInRealTime(request, 
            newTimeAppointments.filter(appt => appt.appointmentId !== appointment.Id)
          );
          if (!validationResult.isValid) {
            throw new Error(`Rescheduling validation failed: ${validationResult.conflicts.map(c => c.description).join(', ')}`);
          }

          // Process client preferences
    const { requirements, priority } = await this.processClientPreferences(
        appointment.ClientId.toString(),
        request
      );
      
      // Update request with processed preferences
      request.requirements = {
        ...request.requirements,
        ...requirements
      };  

          // Create office assignment service instance
          const assignmentService = new OfficeAssignmentService(
            await this.sheetsService.getOffices(),
            await this.sheetsService.getAssignmentRules(),
            await this.getClientPreference(appointment.ClientId.toString()),
            this.createBookingsMap(
              newTimeAppointments.filter(appt => appt.appointmentId !== appointment.Id)
            )
          );

          // Find optimal office for new time
          const assignmentResult = await assignmentService.findOptimalOffice(request);

          if (!assignmentResult.success) {
            throw new Error(assignmentResult.error || 'Failed to find suitable office for updated time');
          }

          // Create updated appointment record
          const updatedAppointment: AppointmentRecord = {
            ...existingAppointment,
            startTime: appointment.StartDateIso,
            endTime: appointment.EndDateIso,
            officeId: assignmentResult.officeId!,
            lastUpdated: new Date().toISOString(),
            requirements: {
              accessibility: request.requirements?.accessibility ?? false,
              specialFeatures: request.requirements?.specialFeatures ?? []
            },
            notes: assignmentResult.notes
          };

          // Update appointment in sheets
          await this.sheetsService.updateAppointment(updatedAppointment);

          // Log successful rescheduling
          await this.sheetsService.addAuditLog({
            timestamp: new Date().toISOString(),
            eventType: AuditEventType.APPOINTMENT_UPDATED,
            description: `Rescheduled appointment ${appointment.Id}`,
            user: 'SYSTEM',
            previousValue: JSON.stringify({
              startTime: existingAppointment.startTime,
              endTime: existingAppointment.endTime,
              officeId: existingAppointment.officeId
            }),
            newValue: JSON.stringify({
              startTime: updatedAppointment.startTime,
              endTime: updatedAppointment.endTime,
              officeId: updatedAppointment.officeId
            })
          });
        } else {
          // Handle non-time updates (e.g., service type changes)
          const updatedAppointment: AppointmentRecord = {
            ...existingAppointment,
            sessionType: this.determineSessionType(appointment),
            lastUpdated: new Date().toISOString(),
            requirements: {
              accessibility: request.requirements?.accessibility ?? false,
              specialFeatures: request.requirements?.specialFeatures ?? []
            }
          };

          await this.sheetsService.updateAppointment(updatedAppointment);
        }

        return {
          success: true,
          appointmentId: appointment.Id,
          action: 'updated'
        };
  
        return {
          success: true,
          appointmentId: appointment.Id,
          action: 'updated'
        };
      } catch (error) {
        console.error('Error handling appointment update:', error);
        throw error;
      }
    }
  /**
   * Handle recurring appointment series
   */
  private async handleRecurringAppointment(
    appointment: IntakeQAppointment,
    recurrencePattern: {
      frequency: 'weekly' | 'biweekly' | 'monthly';
      occurrences: number;
      endDate?: string;
    }
  ): Promise<AppointmentProcessingResult> {
    try {
      const appointments: AppointmentRecord[] = [];
      let currentDate = new Date(appointment.StartDateIso);
      const endDate = recurrencePattern.endDate 
        ? new Date(recurrencePattern.endDate)
        : null;
      
      let occurrenceCount = 0;
      
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
        if (!result.success) {
          throw new Error(
            `Failed to schedule occurrence ${occurrenceCount + 1}: ${result.error}`
          );
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

      return {
        success: true,
        appointmentId: appointment.Id,
        action: 'recurring-created'
      };
    } catch (error) {
      console.error('Error handling recurring appointment:', error);
      throw error;
    }
  }
    /**
 * Handle appointment cancellation
 */
private async handleAppointmentCancellation(
    appointment: IntakeQAppointment
  ): Promise<AppointmentProcessingResult> {
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
          action: 'cancellation-failed'
        };
      }
  
      // Update appointment status
      const cancelledAppointment: AppointmentRecord = {
        ...existingAppointment,
        status: 'cancelled',
        lastUpdated: new Date().toISOString(),
        notes: `Cancelled via IntakeQ: ${appointment.CancellationReason || 'No reason provided'}`
      };
  
      // Update in sheets
      await this.sheetsService.updateAppointment(cancelledAppointment);
  
      // Log cancellation
      await this.sheetsService.addAuditLog({
        timestamp: new Date().toISOString(),
        eventType: AuditEventType.APPOINTMENT_CANCELLED,
        description: `Cancelled appointment ${appointment.Id}`,
        user: 'SYSTEM',
        previousValue: JSON.stringify(existingAppointment),
        newValue: JSON.stringify(cancelledAppointment)
      });
  
      return {
        success: true,
        appointmentId: appointment.Id,
        action: 'cancelled'
      };
    } catch (error) {
      console.error('Error handling appointment cancellation:', error);
      throw error;
    }
  }

    /**
     * Convert IntakeQ appointment to internal scheduling request format
     */
    private convertToSchedulingRequest(
      appointment: IntakeQAppointment
    ): SchedulingRequest {
      return {
        clientId: appointment.ClientId.toString(),
        clinicianId: appointment.PractitionerId,
        dateTime: appointment.StartDateIso,
        duration: appointment.Duration,
        sessionType: this.determineSessionType(appointment),
        requirements: {
          // These would need to be determined from client preferences
          accessibility: false,
          specialFeatures: []
        }
      };
    }
  
    /**
 * Determine session type from IntakeQ service data
 */
private determineSessionType(appointment: IntakeQAppointment): 'in-person' | 'telehealth' | 'group' | 'family' {
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

  /**
 * Send daily assignment notifications
 */
private async sendDailyAssignmentNotifications(
    appointment: AppointmentRecord,
    assignmentChanges: boolean = false
  ): Promise<void> {
    try {
      const appointmentDate = new Date(appointment.startTime).toISOString().split('T')[0];
      
      // Get all appointments for the day
      const dailyAppointments = await this.sheetsService.getAppointments(
        `${appointmentDate}T00:00:00Z`,
        `${appointmentDate}T23:59:59Z`
      );
  
      // Get office data
      const offices = await this.sheetsService.getOffices();
      const clinicians = await this.sheetsService.getClinicians();
  
      // Organize assignments by office
      const officeAssignments = new Map<string, AppointmentRecord[]>();
      dailyAppointments.forEach(appt => {
        if (!officeAssignments.has(appt.officeId)) {
          officeAssignments.set(appt.officeId, []);
        }
        officeAssignments.get(appt.officeId)?.push(appt);
      });
  
      // Check for potential issues
      const alerts: Array<{
        type: 'conflict' | 'accessibility' | 'capacity';
        message: string;
        severity: 'high' | 'medium' | 'low';
      }> = [];
  
      // Check for double bookings
      offices.forEach(office => {
        const officeAppts = officeAssignments.get(office.officeId) || [];
        officeAppts.forEach((appt1, i) => {
          officeAppts.slice(i + 1).forEach(appt2 => {
            const start1 = new Date(appt1.startTime);
            const end1 = new Date(appt1.endTime);
            const start2 = new Date(appt2.startTime);
            const end2 = new Date(appt2.endTime);
  
            if (start1 < end2 && end1 > start2) {
              alerts.push({
                type: 'conflict',
                message: `Schedule conflict in ${office.name} between ${appt1.appointmentId} and ${appt2.appointmentId}`,
                severity: 'high'
              });
            }
          });
        });
      });
  
      // Add audit log for notifications
      await this.sheetsService.addAuditLog({
        timestamp: new Date().toISOString(),
        eventType: AuditEventType.DAILY_ASSIGNMENTS_UPDATED,
        description: `Updated daily assignments for ${appointmentDate}`,
        user: 'SYSTEM',
        systemNotes: JSON.stringify({
          appointments: dailyAppointments,
          alerts
        })
      });
  
    } catch (error) {
      console.error('Error sending daily assignment notifications:', error);
      throw error;
    }
  }

    /**
   * Get client preferences if they exist
   */
  private async getClientPreference(
    clientId: string
  ): Promise<ClientPreference | undefined> {
    const preferences = await this.sheetsService.getClientPreferences();
    return preferences.find(pref => pref.clientId === clientId);
  }

  /**
   * Process client preferences for scheduling
   */
  private async processClientPreferences(
    clientId: string,
    request: SchedulingRequest
  ): Promise<{
    requirements: {
      accessibility: boolean;
      specialFeatures: string[];
      roomPreference?: string;
    };
    priority: number;
  }> {
    const clientPref = await this.getClientPreference(clientId);
    
    if (!clientPref) {
      return {
        requirements: {
          accessibility: false,
          specialFeatures: []
        },
        priority: 0
      };
    }

    // Calculate preference priority
    let priority = 0;
    
    // Higher priority for accessibility needs
    if (clientPref.mobilityNeeds.length > 0) {
      priority += 100;
    }

    // Priority for room consistency
    if (clientPref.roomConsistency >= 4) {
      priority += 50;
      if (clientPref.assignedOffice) {
        return {
          requirements: {
            accessibility: clientPref.mobilityNeeds.length > 0,
            specialFeatures: [
              ...clientPref.sensoryPreferences,
              ...clientPref.physicalNeeds
            ],
            roomPreference: clientPref.assignedOffice
          },
          priority: priority + 25
        };
      }
    }

    // Combine special features
    const specialFeatures = [
      ...clientPref.sensoryPreferences,
      ...clientPref.physicalNeeds
    ].filter((value, index, self) => self.indexOf(value) === index);

    return {
      requirements: {
        accessibility: clientPref.mobilityNeeds.length > 0,
        specialFeatures,
        roomPreference: clientPref.assignedOffice
      },
      priority
    };
  }

  /**
   * Create bookings map for office assignment
   */
  private createBookingsMap(
    appointments: AppointmentRecord[]
  ): Map<string, SchedulingRequest[]> {
    const bookingsMap = new Map<string, SchedulingRequest[]>();
    
    appointments.forEach(appointment => {
      if (!bookingsMap.has(appointment.officeId)) {
        bookingsMap.set(appointment.officeId, []);
      }
      
      bookingsMap.get(appointment.officeId)?.push({
        clientId: appointment.clientId,
        clinicianId: appointment.clinicianId,
        dateTime: appointment.startTime,
        duration: this.calculateDuration(appointment.startTime, appointment.endTime),
        sessionType: appointment.sessionType,
        requirements: appointment.requirements
      });
    });
    
    return bookingsMap;
  }

  /**
   * Validate schedule in real-time
   */
  public async validateScheduleInRealTime(
    request: SchedulingRequest,
    existingBookings: AppointmentRecord[]
  ): Promise<{
    isValid: boolean;
    conflicts: Array<{
      type: 'double-booking' | 'capacity' | 'availability';
      description: string;
    }>;
  }> {
    const conflicts: Array<{
      type: 'double-booking' | 'capacity' | 'availability';
      description: string;
    }> = [];

    // Get office capacities and constraints
    const offices = await this.sheetsService.getOffices();
    const assignmentRules = await this.sheetsService.getAssignmentRules();

    // Check clinician availability
    const clinicianBookings = existingBookings.filter(
      booking => booking.clinicianId === request.clinicianId
    );

    const requestStart = new Date(request.dateTime);
    const requestEnd = new Date(
      requestStart.getTime() + (request.duration * 60000)
    );

    // Check for clinician double-booking
    const hasClinicianConflict = clinicianBookings.some(booking => {
      const bookingStart = new Date(booking.startTime);
      const bookingEnd = new Date(booking.endTime);
      return (
        requestStart < bookingEnd && requestEnd > bookingStart
      );
    });

    if (hasClinicianConflict) {
      conflicts.push({
        type: 'double-booking',
        description: 'Clinician is already booked during this time'
      });
    }

    // Check office capacity constraints
    const officeBookings = new Map<string, AppointmentRecord[]>();
    existingBookings.forEach(booking => {
      if (!officeBookings.has(booking.officeId)) {
        officeBookings.set(booking.officeId, []);
      }
      officeBookings.get(booking.officeId)?.push(booking);
    });

    // Validate against assignment rules
    assignmentRules
      .filter(rule => rule.active)
      .forEach(rule => {
        // Check capacity rules
        if (rule.ruleType === 'capacity') {
          rule.officeIds.forEach(officeId => {
            const officeAppts = officeBookings.get(officeId) || [];
            const concurrent = officeAppts.filter(appt => {
              const apptStart = new Date(appt.startTime);
              const apptEnd = new Date(appt.endTime);
              return requestStart < apptEnd && requestEnd > apptStart;
            });

            if (concurrent.length >= 1) {
              conflicts.push({
                type: 'capacity',
                description: `Office ${officeId} is at capacity during requested time`
              });
            }
          });
        }
      });

    return {
      isValid: conflicts.length === 0,
      conflicts
    };
  }

  /**
   * Calculate duration in minutes between start and end time
   */
  private calculateDuration(startTime: string, endTime: string): number {
    const start = new Date(startTime);
    const end = new Date(endTime);
    return Math.round((end.getTime() - start.getTime()) / (1000 * 60));
  }

  /**
 * Handle error notifications
 */
private async handleError(
    error: Error,
    context: {
      appointmentId: string;
      action: string;
      details?: any;
    }
  ): Promise<void> {
    try {
      // Log error to audit trail
      await this.sheetsService.addAuditLog({
        timestamp: new Date().toISOString(),
        eventType: AuditEventType.SYSTEM_ERROR,
        description: `Error during ${context.action} for appointment ${context.appointmentId}`,
        user: 'SYSTEM',
        systemNotes: JSON.stringify({
          error: error.message,
          stack: error.stack,
          context
        })
      });
  
      // Check error severity
      const isCritical = this.isCriticalError(error);
      if (isCritical) {
        await this.notifyCriticalError({
          error,
          context,
          timestamp: new Date().toISOString()
        });
      }
    } catch (notificationError) {
      console.error('Error handling error notification:', notificationError);
      // Fallback to console logging if notification fails
      console.error('Original error:', error);
      console.error('Error context:', context);
    }
  }
  
  /**
   * Determine if error is critical
   */
  private isCriticalError(error: Error): boolean {
    const criticalPatterns = [
      'double booking',
      'invalid office assignment',
      'scheduling conflict',
      'accessibility requirement',
      'database error',
      'authentication failed'
    ];
  
    return criticalPatterns.some(pattern => 
      error.message.toLowerCase().includes(pattern)
    );
  }
  
  /**
   * Notify critical errors
   */
  private async notifyCriticalError(errorData: {
    error: Error;
    context: any;
    timestamp: string;
  }): Promise<void> {
    await this.sheetsService.addAuditLog({
      timestamp: errorData.timestamp,
      eventType: AuditEventType.CRITICAL_ERROR,
      description: 'Critical system error detected',
      user: 'SYSTEM',
      systemNotes: JSON.stringify(errorData)
    });
  }
  }