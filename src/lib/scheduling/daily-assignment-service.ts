// src/lib/scheduling/daily-assignment-service.ts

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
      private readonly sheetsService: GoogleSheetsService
    ) {}
  
    /**
     * Generate daily schedule summary
     */
    async generateDailySummary(date: string): Promise<DailyScheduleSummary> {
      try {
        // Fetch all required data
        const [appointments, offices, clinicians, clientPreferences] = await Promise.all([
          this.sheetsService.getOfficeAppointments('all', date),
          this.sheetsService.getOffices(),
          this.sheetsService.getClinicians(),
          this.sheetsService.getClientPreferences()
        ]);
  
        // Initialize summary structure
        const summary: DailyScheduleSummary = {
          date,
          appointments,
          conflicts: [],
          officeUtilization: new Map(),
          alerts: []
        };
  
        // Process appointments and check for conflicts
        this.processAppointments(summary, appointments, offices, clinicians, clientPreferences);
  
        // Calculate office utilization
        this.calculateOfficeUtilization(summary, offices);
  
        // Generate alerts
        this.generateAlerts(summary);
  
        // Log summary generation
        await this.sheetsService.addAuditLog({
          timestamp: new Date().toISOString(),
          eventType: AuditEventType.DAILY_ASSIGNMENTS_UPDATED,
          description: `Generated daily summary for ${date}`,
          user: 'SYSTEM',
          systemNotes: JSON.stringify({
            appointmentCount: appointments.length,
            conflictCount: summary.conflicts.length,
            alertCount: summary.alerts.length
          })
        });
  
        return summary;
      } catch (error) {
        console.error('Error generating daily summary:', error);
        throw error;
      }
    }
  
    /**
     * Process appointments and identify conflicts
     */
    private processAppointments(
      summary: DailyScheduleSummary,
      appointments: AppointmentRecord[],
      offices: SheetOffice[],
      clinicians: SheetClinician[],
      clientPreferences: ClientPreference[]
    ): void {
      // Check for double bookings
      appointments.forEach((appt1, i) => {
        appointments.slice(i + 1).forEach(appt2 => {
          if (this.appointmentsOverlap(appt1, appt2)) {
            // Same office double booking
            if (appt1.officeId === appt2.officeId) {
              summary.conflicts.push({
                type: 'double-booking',
                description: `Schedule conflict in office ${appt1.officeId}`,
                severity: 'high',
                officeId: appt1.officeId,
                appointmentIds: [appt1.appointmentId, appt2.appointmentId]
              });
            }
  
            // Same clinician double booking
            if (appt1.clinicianId === appt2.clinicianId) {
              summary.conflicts.push({
                type: 'double-booking',
                description: `Clinician ${appt1.clinicianId} double booked`,
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
            description: `Client requires accessible office but assigned to non-accessible space`,
            severity: 'high',
            officeId: appt1.officeId,
            appointmentIds: [appt1.appointmentId]
          });
        }
      });
    }
  
    /**
     * Calculate office utilization
     */
    private calculateOfficeUtilization(
      summary: DailyScheduleSummary,
      offices: SheetOffice[]
    ): void {
      offices.forEach(office => {
        const officeAppointments = summary.appointments.filter(
          appt => appt.officeId === office.officeId
        );
  
        // Assuming 8 hour day with 1 hour slots
        const totalSlots = 8;
        const bookedSlots = officeAppointments.length;
  
        summary.officeUtilization.set(office.officeId, {
          totalSlots,
          bookedSlots,
          specialNotes: this.getOfficeNotes(office, bookedSlots / totalSlots)
        });
  
        // Check for capacity issues
        if (bookedSlots / totalSlots > 0.9) {
          summary.alerts.push({
            type: 'capacity',
            message: `Office ${office.officeId} is near capacity`,
            severity: 'medium'
          });
        }
      });
    }
  
    /**
     * Generate system alerts
     */
    private generateAlerts(summary: DailyScheduleSummary): void {
      // High priority conflicts
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
  
      // Capacity warnings
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
  
    /**
     * Get special notes for office utilization
     */
    private getOfficeNotes(office: SheetOffice, utilization: number): string[] {
      const notes: string[] = [];
  
      if (utilization > 0.9) {
        notes.push('Critical capacity warning');
      } else if (utilization > 0.8) {
        notes.push('High utilization');
      }
  
      if (office.isFlexSpace) {
        notes.push('Flex space - coordinate with team');
      }
  
      return notes;
    }
  
    /**
     * Check if two appointments overlap
     */
    private appointmentsOverlap(appt1: AppointmentRecord, appt2: AppointmentRecord): boolean {
      const start1 = new Date(appt1.startTime);
      const end1 = new Date(appt1.endTime);
      const start2 = new Date(appt2.startTime);
      const end2 = new Date(appt2.endTime);
  
      return start1 < end2 && end1 > start2;
    }
  
    /**
     * Format daily summary as HTML email
     */
    formatEmailContent(summary: DailyScheduleSummary): string {
      return `
        <h1>Daily Schedule Summary - ${summary.date}</h1>
        
        ${this.formatAlerts(summary.alerts)}
        
        ${this.formatConflicts(summary.conflicts)}
        
        ${this.formatAppointments(summary.appointments)}
        
        ${this.formatOfficeUtilization(summary.officeUtilization)}
        
        <p>Generated on ${new Date().toLocaleString()}</p>
      `;
    }
  
    private formatAlerts(alerts: DailyScheduleSummary['alerts']): string {
      if (alerts.length === 0) return '';
  
      return `
        <h2>Alerts</h2>
        <ul>
          ${alerts.map(alert => `
            <li style="color: ${this.getSeverityColor(alert.severity)}">
              ${alert.type.toUpperCase()}: ${alert.message}
            </li>
          `).join('')}
        </ul>
      `;
    }
  
    private formatConflicts(conflicts: DailyScheduleSummary['conflicts']): string {
      if (conflicts.length === 0) return '';
  
      return `
        <h2>Conflicts</h2>
        <ul>
          ${conflicts.map(conflict => `
            <li style="color: ${this.getSeverityColor(conflict.severity)}">
              ${conflict.type}: ${conflict.description}
              ${conflict.officeId ? `(Office: ${conflict.officeId})` : ''}
            </li>
          `).join('')}
        </ul>
      `;
    }
  
    private formatAppointments(appointments: AppointmentRecord[]): string {
      return `
        <h2>Appointments</h2>
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <th>Time</th>
            <th>Office</th>
            <th>Client</th>
            <th>Clinician</th>
            <th>Type</th>
          </tr>
          ${appointments
            .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
            .map(appt => `
              <tr>
                <td>${new Date(appt.startTime).toLocaleTimeString()} - ${new Date(appt.endTime).toLocaleTimeString()}</td>
                <td>${appt.officeId}</td>
                <td>${appt.clientId}</td>
                <td>${appt.clinicianId}</td>
                <td>${appt.sessionType}</td>
              </tr>
            `).join('')}
        </table>
      `;
    }
  
    private formatOfficeUtilization(utilization: DailyScheduleSummary['officeUtilization']): string {
      return `
        <h2>Office Utilization</h2>
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <th>Office</th>
            <th>Utilization</th>
            <th>Notes</th>
          </tr>
          ${Array.from(utilization.entries()).map(([officeId, data]) => `
            <tr>
              <td>${officeId}</td>
              <td>${Math.round((data.bookedSlots / data.totalSlots) * 100)}%</td>
              <td>${data.specialNotes?.join(', ') || ''}</td>
            </tr>
          `).join('')}
        </table>
      `;
    }
  
    private getSeverityColor(severity: 'high' | 'medium' | 'low'): string {
      switch (severity) {
        case 'high':
          return '#dc2626';
        case 'medium':
          return '#d97706';
        case 'low':
          return '#059669';
        default:
          return '#000000';
      }
    }
  }