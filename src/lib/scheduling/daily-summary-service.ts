// src/lib/scheduling/daily-summary-service.ts

import type { 
    DailyScheduleSummary,
    AppointmentRecord
  } from '@/types/scheduling';
  import type { SheetOffice } from '@/types/sheets';
  
  export class DailySummaryService {
    constructor(
      private readonly offices: SheetOffice[],
      private readonly appointments: AppointmentRecord[]
    ) {}
  
    async generateDailySummary(date: string): Promise<DailyScheduleSummary> {
      const conflicts: DailyScheduleSummary['conflicts'] = [];
      const alerts: DailyScheduleSummary['alerts'] = [];
      const officeUtilization = new Map<string, {
        totalSlots: number;
        bookedSlots: number;
        specialNotes?: string[];
      }>();
  
      // Initialize office utilization
      this.offices.forEach(office => {
        const officeAppointments = this.appointments.filter(
          appt => appt.officeId === office.officeId
        );
  
        officeUtilization.set(office.officeId, {
          totalSlots: 8, // Assuming 8 hour workday
          bookedSlots: officeAppointments.length,
          specialNotes: office.isFlexSpace ? ['Flex space - coordinate with team'] : []
        });
  
        // Check utilization
        if (officeAppointments.length / 8 > 0.9) {
          alerts.push({
            type: 'capacity',
            message: `Office ${office.officeId} is near capacity (>90% booked)`,
            severity: 'high'
          });
        }
      });
  
      // Check for conflicts
      this.offices.forEach(office => {
        const officeAppointments = this.appointments.filter(
          appt => appt.officeId === office.officeId
        );
  
        officeAppointments.forEach((appt1, i) => {
          officeAppointments.slice(i + 1).forEach(appt2 => {
            const start1 = new Date(appt1.startTime);
            const end1 = new Date(appt1.endTime);
            const start2 = new Date(appt2.startTime);
            const end2 = new Date(appt2.endTime);
  
            if (start1 < end2 && end1 > start2) {
              conflicts.push({
                type: 'double-booking',
                description: `Schedule conflict in office ${office.officeId}`,
                severity: 'high',
                officeId: office.officeId,
                appointmentIds: [appt1.appointmentId, appt2.appointmentId]
              });
            }
          });
        });
      });
  
      return {
        date,
        appointments: this.appointments,
        conflicts,
        alerts,
        officeUtilization
      };
    }
  }