// src/lib/email/templates.ts

import type { AppointmentRecord, StandardOfficeId } from '@/types/scheduling';
import { format } from 'date-fns';

interface EmailTemplate {
  subject: string;
  html: string;
  text: string;
}

interface EmailTemplateParams {
  date: string;
  appointments: AppointmentRecord[];
  alerts: Array<{ type: string; message: string; severity: 'high' | 'medium' | 'low' }>;
  officeUtilization?: Map<StandardOfficeId, {
    totalSlots: number;
    bookedSlots: number;
    specialNotes?: string[];
  }>;
}

export class EmailTemplates {
  static dailySchedule({
    date,
    appointments = [], // Default to empty array
    alerts = [],      // Default to empty array
    officeUtilization
  }: EmailTemplateParams): EmailTemplate {
    // Ensure we have arrays to work with
    const safeAppointments = Array.isArray(appointments) ? appointments : [];
    const safeAlerts = Array.isArray(alerts) ? alerts : [];

    // Group appointments by clinician
    const appointmentsByClinicianId = safeAppointments.reduce((acc, appointment) => {
      if (!appointment?.clinicianId) return acc; // Skip invalid appointments
      
      const clinicianId = appointment.clinicianId;
      if (!acc[clinicianId]) {
        acc[clinicianId] = {
          clinicianName: appointment.clinicianName || 'Unknown Clinician',
          lastName: appointment.clinicianName?.split(' ').pop() || 'Unknown',
          appointments: []
        };
      }
      acc[clinicianId].appointments.push(appointment);
      return acc;
    }, {} as Record<string, { 
      clinicianName: string; 
      lastName: string;
      appointments: AppointmentRecord[] 
    }>);

    // Sort clinicians by last name
    const sortedClinicians = Object.values(appointmentsByClinicianId)
      .sort((a, b) => a.lastName.localeCompare(b.lastName));

    // Sort appointments for each clinician by time
    sortedClinicians.forEach(clinicianData => {
      clinicianData.appointments.sort((a, b) => {
        const timeA = new Date(a.startTime).getTime();
        const timeB = new Date(b.startTime).getTime();
        return timeA - timeB;
      });
    });

    // Format dates for header ensuring EST timezone
    const tomorrow = new Date(date);
tomorrow.setDate(tomorrow.getDate() + 1);
const formattedDate = format(tomorrow, 'EEEE, MMMM d, yyyy');

    // Build HTML content
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto;">
        <h1 style="color: #333; margin-bottom: 5px;">Today's Schedule & Office Assignments</h1>
        <h2 style="color: #666; font-size: 1.2em; margin-top: 0;">${formattedDate}</h2>
        
        ${safeAlerts.length > 0 ? `
          <div style="margin: 20px 0;">
            <h2 style="color: #333;">Alerts</h2>
            ${safeAlerts.map(alert => `
              <div style="
                padding: 10px; 
                margin: 5px 0; 
                background-color: ${alert.severity === 'high' ? '#ffe6e6' : 
                                  alert.severity === 'medium' ? '#fff3e6' : 
                                  '#e6ffe6'};
                border-radius: 4px;"
              >
                <strong>${alert.type}:</strong> ${alert.message}
              </div>
            `).join('')}
          </div>
        ` : ''}

        ${sortedClinicians.map(({ clinicianName, appointments }) => `
          <div style="margin: 30px 0;">
            <h2 style="color: #333; border-bottom: 2px solid #eee; padding-bottom: 5px;">
              ${clinicianName}
            </h2>
            <table style="width: 100%; border-collapse: collapse; margin-top: 10px;">
              <thead>
                <tr style="background-color: #f5f5f5;">
                  <th style="padding: 8px; text-align: left; border: 1px solid #ddd;">Time</th>
                  <th style="padding: 8px; text-align: left; border: 1px solid #ddd;">Client</th>
                  <th style="padding: 8px; text-align: left; border: 1px solid #ddd;">Type</th>
                  <th style="padding: 8px; text-align: left; border: 1px solid #ddd;">Office</th>
                </tr>
              </thead>
              <tbody>
                ${appointments.map(appt => `
                  <tr>
                    <td style="padding: 8px; border: 1px solid #ddd;">
                      ${format(new Date(appt.startTime), 'h:mm a')} - ${format(new Date(appt.endTime), 'h:mm a')}
                    </td>
                    <td style="padding: 8px; border: 1px solid #ddd;">${appt.clientName || 'Unknown Client'}</td>
                    <td style="padding: 8px; border: 1px solid #ddd;">${appt.sessionType || 'Unknown Type'}</td>
                    <td style="padding: 8px; border: 1px solid #ddd;">${appt.suggestedOfficeId || 'TBD'}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        `).join('')}
        
        <div style="color: #666; font-size: 12px; margin-top: 30px; border-top: 1px solid #eee; padding-top: 10px;">
          Generated ${format(new Date(), 'M/d/yyyy, h:mm:ss a')}
        </div>
      </div>
    `;

    // Plain text version
    const text = `Today's Schedule & Office Assignments\n${formattedDate}\n\n` +
      (safeAlerts.length > 0 ? `Alerts:\n${safeAlerts.map(alert => 
        `${alert.type}: ${alert.message}`).join('\n')}\n\n` : '') +
      sortedClinicians.map(({ clinicianName, appointments }) => 
        `${clinicianName}\n${'-'.repeat(clinicianName.length)}\n` +
        appointments.map(appt => 
          `${format(new Date(appt.startTime), 'h:mm a')} - ${format(new Date(appt.endTime), 'h:mm a')}: ` +
          `${appt.clientName || 'Unknown Client'} (${appt.sessionType || 'Unknown Type'}) - ` +
          `Office: ${appt.suggestedOfficeId}`
        ).join('\n')
      ).join('\n\n') +
      `\n\nGenerated ${format(new Date(), 'M/d/yyyy, h:mm:ss a')}`;

    return {
      subject: `Today's Schedule & Office Assignments - ${formattedDate}`,
      html,
      text
    };
  }
}