// src/lib/scheduling/daily-summary-service.ts

import type { 
  DailyScheduleSummary,
  AppointmentRecord,
  StandardOfficeId
} from '@/types/scheduling';
import type { SheetOffice } from '@/types/sheets';
import { standardizeOfficeId } from '@/lib/util/office-id';

export class DailySummaryService {
  constructor(
    private readonly offices: SheetOffice[],
    private readonly appointments: AppointmentRecord[]
  ) {}

  // Update Map type to use StandardOfficeId
  async generateDailySummary(date: string): Promise<DailyScheduleSummary> {
    const conflicts: DailyScheduleSummary['conflicts'] = [];
    const alerts: DailyScheduleSummary['alerts'] = [];
    const officeUtilization = new Map<StandardOfficeId, {
      totalSlots: number;
      bookedSlots: number;
      specialNotes?: string[];
    }>();

    // Standardize office IDs when initializing
    this.offices.forEach(office => {
      const standardizedId = standardizeOfficeId(office.officeId);
      const officeAppointments = this.appointments.filter(
        appt => standardizeOfficeId(appt.officeId) === standardizedId
      );

      officeUtilization.set(standardizedId, {
        totalSlots: 8,
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
                officeId: standardizeOfficeId(office.officeId),
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