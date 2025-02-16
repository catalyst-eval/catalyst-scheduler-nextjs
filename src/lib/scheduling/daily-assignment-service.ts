// src/lib/scheduling/daily-assignment-service.ts

import { toEST, getESTDayRange, isSameESTDay } from '../util/date-helpers';
import type { 
  AppointmentRecord,
  SchedulingConflict 
} from '@/types/scheduling';
import type { 
  SheetOffice, 
  SheetClinician, 
  ClientPreference
} from '@/types/sheets';

import { GoogleSheetsService, AuditEventType } from '@/lib/google/sheets';
import type { IntakeQService } from '@/lib/intakeq/service';
import { OfficeAssignmentService } from './office-assignment';

interface DailyScheduleSummary {
  date: string;
  appointments: AppointmentRecord[];
  conflicts: Array<{
    type: 'double-booking' | 'accessibility' | 'capacity';
    description: string;
    severity: 'high' | 'medium' | 'low';
    officeId?: string;
    appointmentIds?: string[];
  }>;
  officeUtilization: Map<string, {
    totalSlots: number;
    bookedSlots: number;
    specialNotes?: string[];
  }>;
  alerts: Array<{
    type: 'accessibility' | 'capacity' | 'scheduling' | 'system';
    message: string;
    severity: 'high' | 'medium' | 'low';
  }>;
}

export class DailyAssignmentService {
  constructor(
    private readonly sheetsService: GoogleSheetsService,
    private readonly intakeQService: IntakeQService
  ) {}

  async generateDailySummary(date: string): Promise<DailyScheduleSummary> {
    try {
      console.log('Generating daily summary for:', date);
      
      // Get date range in EST
      const range = getESTDayRange(date);
const startOfDay = range.start;
const endOfDay = range.end;
      
      console.log('Date range for summary:', {
        requestedDate: date,
        startOfDay,
        endOfDay,
        estDate: toEST(date).toLocaleString('en-US', { timeZone: 'America/New_York' })
      });

      // Fetch all required data
      console.log('Fetching data...');
      const [intakeQAppointments, offices, clinicians, clientPreferences, localAppointments] = await Promise.all([
        this.intakeQService.getAppointments(startOfDay, endOfDay),
        this.sheetsService.getOffices(),
        this.sheetsService.getClinicians(),
        this.sheetsService.getClientPreferences(),
        this.sheetsService.getAppointments(startOfDay, endOfDay)
      ]);

      console.log('Found appointments:', {
        intakeQ: intakeQAppointments.length,
        local: localAppointments.length
      });

      // Create lookup maps
      const clinicianMap = new Map(
        clinicians.map(c => [c.intakeQPractitionerId, c]) // Map practitioner ID to clinician object
      );

      // Process appointments
      console.log('Processing IntakeQ appointments...');
      const processedIntakeQAppointments = await Promise.all(intakeQAppointments.map(async intakeQAppt => {
        // Get local appointment if exists
        const localAppt = localAppointments.find(appt => appt.appointmentId === intakeQAppt.Id);
        const clinician = clinicianMap.get(intakeQAppt.PractitionerId);

        // If no local appointment exists, assign an office
        let officeId = localAppt?.officeId;
        let notes = localAppt?.notes;

        if (!officeId && clinician) {
          const assignmentService = new OfficeAssignmentService(
            offices,
            await this.sheetsService.getAssignmentRules(),
            clinicians
          );

          const result = await assignmentService.findOptimalOffice({
            clientId: intakeQAppt.ClientId.toString(),
            clinicianId: clinician.clinicianId,
            dateTime: intakeQAppt.StartDateIso,
            duration: this.calculateDuration(intakeQAppt.StartDateIso, intakeQAppt.EndDateIso),
            sessionType: this.determineSessionType(intakeQAppt.ServiceName)
          });

          if (result.success) {
            officeId = result.officeId;
            notes = result.notes;
          }
        }

        return {
          appointmentId: intakeQAppt.Id,
          clientId: intakeQAppt.ClientId.toString(),
          clientName: intakeQAppt.ClientName,
          clinicianId: clinicianMap.get(intakeQAppt.PractitionerId)?.clinicianId || intakeQAppt.PractitionerId,
    clinicianName: clinicianMap.get(intakeQAppt.PractitionerId)?.name || 'Unknown',
          officeId: officeId || '',
          sessionType: this.determineSessionType(intakeQAppt.ServiceName),
          startTime: intakeQAppt.StartDateIso,
          endTime: intakeQAppt.EndDateIso,
          status: localAppt?.status || 'scheduled',
          lastUpdated: new Date().toISOString(),
          source: localAppt?.source || 'intakeq' as 'intakeq' | 'manual',
          requirements: localAppt?.requirements || {
            accessibility: false,
            specialFeatures: []
          },
          notes
        };
      }));

      // Sort appointments by time
      // Process local appointments that aren't from IntakeQ
      console.log('Processing local appointments...');
      const localOnlyAppointments = localAppointments.filter(
        local => !intakeQAppointments.some(intakeQ => intakeQ.Id === local.appointmentId)
      );

      console.log('Appointment counts:', {
        intakeQ: processedIntakeQAppointments.length,
        localOnly: localOnlyAppointments.length
      });

      // Combine all appointments
      const allAppointments = [...processedIntakeQAppointments, ...localOnlyAppointments];

      // Sort appointments by time
      allAppointments.sort((a, b) => {
        if (a.clinicianName < b.clinicianName) return -1;
        if (a.clinicianName > b.clinicianName) return 1;
        return new Date(a.startTime).getTime() - new Date(b.startTime).getTime();
      });

      // Create summary
      const summary: DailyScheduleSummary = {
        date,
        appointments: allAppointments,
        conflicts: [],
        officeUtilization: new Map(),
        alerts: []
      };

      // Process conflicts and generate alerts
      this.processAppointments(summary, allAppointments, offices, clinicians, clientPreferences);
      this.calculateOfficeUtilization(summary, offices);
      this.generateAlerts(summary);

      // Log summary
      await this.sheetsService.addAuditLog({
        timestamp: new Date().toISOString(),
        eventType: AuditEventType.DAILY_ASSIGNMENTS_UPDATED,
        description: `Generated daily summary for ${date}`,
        user: 'SYSTEM',
        systemNotes: JSON.stringify({
          appointmentCount: allAppointments.length,
          conflictCount: summary.conflicts.length,
          alertCount: summary.alerts.length
        })
      });

      console.log('Final summary:', {
        date,
        totalAppointments: summary.appointments.length,
        intakeQCount: processedIntakeQAppointments.length,
        localCount: localOnlyAppointments.length,
        conflicts: summary.conflicts.length,
        alerts: summary.alerts.length,
        sampleAppointments: summary.appointments.slice(0, 2).map(appt => ({
          id: appt.appointmentId,
          client: appt.clientName,
          time: appt.startTime
        }))
      });

      return summary;
    } catch (error) {
      console.error('Error generating daily summary:', error);
      throw error;
    }
  }

  private calculateDuration(startTime: string, endTime: string): number {
    const start = new Date(startTime);
    const end = new Date(endTime);
    return Math.round((end.getTime() - start.getTime()) / (60 * 1000));
  }

  private determineSessionType(serviceName: string): 'in-person' | 'telehealth' | 'group' | 'family' {
    const name = serviceName.toLowerCase();
    if (name.includes('telehealth') || name.includes('virtual')) return 'telehealth';
    if (name.includes('group')) return 'group';
    if (name.includes('family') || name.includes('relationship')) return 'family';
    return 'in-person';
  }

  private processAppointments(
    summary: DailyScheduleSummary,
    appointments: AppointmentRecord[],
    offices: SheetOffice[],
    clinicians: SheetClinician[],
    clientPreferences: ClientPreference[]
  ): void {
    appointments.forEach((appt1, i) => {
      // Check for overlapping appointments
      appointments.slice(i + 1).forEach(appt2 => {
        // Only check for overlaps if appointments are on the same day
        const sameDay = isSameESTDay(appt1.startTime, appt2.startTime);
        
        if (sameDay && this.appointmentsOverlap(appt1, appt2)) {
          // Skip telehealth appointments from conflict detection
          if (appt1.sessionType === 'telehealth' || appt2.sessionType === 'telehealth') {
            return;
          }
          
          // Check for same office conflicts
          if (appt1.officeId === appt2.officeId) {
            summary.conflicts.push({
              type: 'double-booking',
              description: `Schedule conflict in ${appt1.officeId}: ${appt1.clientName || appt1.clientId} and ${appt2.clientName || appt2.clientId}`,
              severity: 'high',
              officeId: appt1.officeId,
              appointmentIds: [appt1.appointmentId, appt2.appointmentId]
            });
          }
    
          // Check for clinician double-booking
          if (appt1.clinicianId === appt2.clinicianId) {
            summary.conflicts.push({
              type: 'double-booking',
              description: `${appt1.clinicianName || appt1.clinicianId} has overlapping appointments`,
              severity: 'high',
              appointmentIds: [appt1.appointmentId, appt2.appointmentId]
            });
          }
        }
      });
      // Check for overlapping appointments
      appointments.slice(i + 1).forEach(appt2 => {
        if (this.appointmentsOverlap(appt1, appt2)) {
          if (appt1.officeId === appt2.officeId) {
            summary.conflicts.push({
              type: 'double-booking',
              description: `Schedule conflict in ${appt1.officeId}: ${appt1.clientName} and ${appt2.clientName}`,
              severity: 'high',
              officeId: appt1.officeId,
              appointmentIds: [appt1.appointmentId, appt2.appointmentId]
            });
          }

          if (appt1.clinicianId === appt2.clinicianId) {
            summary.conflicts.push({
              type: 'double-booking',
              description: `${appt1.clinicianName} has overlapping appointments`,
              severity: 'high',
              appointmentIds: [appt1.appointmentId, appt2.appointmentId]
            });
          }
        }
      });

      // Check accessibility requirements
      const clientPref = clientPreferences.find(
        pref => pref.clientId === appt1.clientId
      );
      const office = offices.find(
        office => office.officeId === appt1.officeId
      );

      if (clientPref?.mobilityNeeds.length && office && !office.isAccessible) {
        summary.conflicts.push({
          type: 'accessibility',
          description: `${appt1.clientName} requires accessible office but assigned to ${appt1.officeId}`,
          severity: 'high',
          officeId: appt1.officeId,
          appointmentIds: [appt1.appointmentId]
        });
      }
    });
  }

  private calculateOfficeUtilization(
    summary: DailyScheduleSummary,
    offices: SheetOffice[]
  ): void {
    offices.forEach(office => {
      const officeAppointments = summary.appointments.filter(
        appt => appt.officeId === office.officeId
      );

      const totalSlots = 8; // 8-hour day
      const bookedSlots = officeAppointments.length;

      const notes: string[] = [];
      if (office.isFlexSpace) {
        notes.push('Flex space - coordinate with team');
      }
      if (bookedSlots / totalSlots > 0.9) {
        notes.push('Critical capacity warning');
      } else if (bookedSlots / totalSlots > 0.8) {
        notes.push('High utilization');
      }

      summary.officeUtilization.set(office.officeId, {
        totalSlots,
        bookedSlots,
        specialNotes: notes
      });
    });
  }

  private appointmentsOverlap(appt1: AppointmentRecord, appt2: AppointmentRecord): boolean {
    // Convert times to minutes since midnight for easier comparison
    const getMinutes = (time: string) => {
      const date = new Date(time);
      return date.getUTCHours() * 60 + date.getUTCMinutes();
    };
  
    const start1 = getMinutes(appt1.startTime);
    const end1 = start1 + this.getDurationMinutes(appt1.startTime, appt1.endTime);
    const start2 = getMinutes(appt2.startTime);
    const end2 = start2 + this.getDurationMinutes(appt2.startTime, appt2.endTime);
  
    console.log('Checking overlap:', {
      appt1: {
        id: appt1.appointmentId,
        client: appt1.clientName || appt1.clientId,
        start: start1,
        end: end1,
        time: new Date(appt1.startTime).toLocaleString()
      },
      appt2: {
        id: appt2.appointmentId,
        client: appt2.clientName || appt2.clientId,
        start: start2,
        end: end2,
        time: new Date(appt2.startTime).toLocaleString()
      }
    });
  
    // Check actual overlap
    return start1 < end2 && end1 > start2;
  }
  
  private getDurationMinutes(startTime: string, endTime: string): number {
    const start = new Date(startTime);
    const end = new Date(endTime);
    return Math.round((end.getTime() - start.getTime()) / (60 * 1000));
  }

  private generateAlerts(summary: DailyScheduleSummary): void {
    // Check high priority conflicts
    const highPriorityConflicts = summary.conflicts.filter(
      conflict => conflict.severity === 'high'
    );

    if (highPriorityConflicts.length > 0) {
      summary.alerts.push({
        type: 'scheduling',
        message: `${highPriorityConflicts.length} high-priority conflicts detected`,
        severity: 'high'
      });
    }

    // Check office capacity
    const highCapacityOffices = Array.from(summary.officeUtilization.entries())
      .filter(([_, data]) => data.bookedSlots / data.totalSlots > 0.8);

    if (highCapacityOffices.length > 0) {
      summary.alerts.push({
        type: 'capacity',
        message: `${highCapacityOffices.length} offices are at high capacity`,
        severity: 'medium'
      });
    }
  }
}