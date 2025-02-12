// src/lib/email/templates.ts

import type { DailyScheduleSummary } from '@/types/scheduling';

export interface EmailTemplate {
  subject: string;
  html: string;
  text: string;
}

export class EmailTemplates {
  static dailySchedule(summary: DailyScheduleSummary): EmailTemplate {
    return {
      subject: this.formatSubject(summary),
      html: this.formatHtml(summary),
      text: this.formatText(summary)
    };
  }

  private static formatSubject(summary: DailyScheduleSummary): string {
    const hasHighPriorityAlerts = summary.alerts.some(a => a.severity === 'high');
    const hasConflicts = summary.conflicts.length > 0;

    let subject = `Daily Schedule - ${summary.date}`;
    if (hasHighPriorityAlerts) {
      subject = `⚠️ ${subject} - HIGH PRIORITY ALERTS`;
    } else if (hasConflicts) {
      subject = `⚠️ ${subject} - Conflicts Detected`;
    }
    return subject;
  }

  private static formatHtml(summary: DailyScheduleSummary): string {
    return `
      <div style="font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto;">
        <h1>Daily Schedule - ${summary.date}</h1>
        ${this.formatAlertsHtml(summary.alerts)}
        ${this.formatConflictsHtml(summary.conflicts)}
        ${this.formatAppointmentsHtml(summary.appointments)}
        ${this.formatUtilizationHtml(summary.officeUtilization)}
        <hr>
        <p style="color: #666; font-size: 12px;">Generated ${new Date().toLocaleString()}</p>
      </div>
    `;
  }

  private static formatText(summary: DailyScheduleSummary): string {
    return `
Daily Schedule - ${summary.date}
==============================

${this.formatAlertsText(summary.alerts)}
${this.formatConflictsText(summary.conflicts)}
${this.formatAppointmentsText(summary.appointments)}
${this.formatUtilizationText(summary.officeUtilization)}

Generated ${new Date().toLocaleString()}
    `.trim();
  }

  private static formatAlertsHtml(alerts: DailyScheduleSummary['alerts']): string {
    if (!alerts.length) return '';
    return `
      <div style="margin: 20px 0;">
        <h2>Alerts</h2>
        ${alerts.map(alert => `
          <div style="padding: 10px; margin: 5px 0; border-radius: 4px; 
               background-color: ${alert.severity === 'high' ? '#fee2e2' : '#fef3c7'};">
            ${alert.type}: ${alert.message}
          </div>
        `).join('')}
      </div>
    `;
  }

  private static formatAlertsText(alerts: DailyScheduleSummary['alerts']): string {
    if (!alerts.length) return '';
    return `ALERTS:\n${alerts.map(a => `${a.type}: ${a.message}`).join('\n')}\n\n`;
  }

  private static formatConflictsHtml(conflicts: DailyScheduleSummary['conflicts']): string {
    if (!conflicts.length) return '';
    return `
      <div style="margin: 20px 0;">
        <h2>Conflicts</h2>
        ${conflicts.map(conflict => `
          <div style="padding: 10px; margin: 5px 0; border-radius: 4px; background-color: #fee2e2;">
            ${conflict.type}: ${conflict.description}
            ${conflict.officeId ? `<br>Office: ${conflict.officeId}` : ''}
          </div>
        `).join('')}
      </div>
    `;
  }

  private static formatConflictsText(conflicts: DailyScheduleSummary['conflicts']): string {
    if (!conflicts.length) return '';
    return `CONFLICTS:\n${conflicts.map(c => c.description).join('\n')}\n\n`;
  }

  private static formatAppointmentsHtml(appointments: DailyScheduleSummary['appointments']): string {
    if (!appointments.length) return '<p>No appointments scheduled.</p>';
    
    return `
      <div style="margin: 20px 0;">
        <h2>Appointments</h2>
        <table style="width: 100%; border-collapse: collapse;">
          <tr style="background-color: #f3f4f6;">
            <th style="text-align: left; padding: 8px;">Time</th>
            <th style="text-align: left; padding: 8px;">Office</th>
            <th style="text-align: left; padding: 8px;">Client</th>
            <th style="text-align: left; padding: 8px;">Clinician</th>
          </tr>
          ${appointments.map(appt => `
            <tr>
              <td style="padding: 8px;">${new Date(appt.startTime).toLocaleTimeString()}</td>
              <td style="padding: 8px;">${appt.officeId}</td>
              <td style="padding: 8px;">${appt.clientId}</td>
              <td style="padding: 8px;">${appt.clinicianId}</td>
            </tr>
          `).join('')}
        </table>
      </div>
    `;
  }

  private static formatAppointmentsText(appointments: DailyScheduleSummary['appointments']): string {
    if (!appointments.length) return 'No appointments scheduled.\n\n';
    return `APPOINTMENTS:\n${appointments.map(a => 
      `${new Date(a.startTime).toLocaleTimeString()} - ${a.officeId} - ${a.clientId}`
    ).join('\n')}\n\n`;
  }

  private static formatUtilizationHtml(utilization: DailyScheduleSummary['officeUtilization']): string {
    return `
      <div style="margin: 20px 0;">
        <h2>Office Utilization</h2>
        <table style="width: 100%; border-collapse: collapse;">
          <tr style="background-color: #f3f4f6;">
            <th style="text-align: left; padding: 8px;">Office</th>
            <th style="text-align: left; padding: 8px;">Usage</th>
            <th style="text-align: left; padding: 8px;">Notes</th>
          </tr>
          ${Array.from(utilization.entries()).map(([id, data]) => `
            <tr>
              <td style="padding: 8px;">${id}</td>
              <td style="padding: 8px;">${Math.round((data.bookedSlots / data.totalSlots) * 100)}%</td>
              <td style="padding: 8px;">${data.specialNotes?.join(', ') || ''}</td>
            </tr>
          `).join('')}
        </table>
      </div>
    `;
  }

  private static formatUtilizationText(utilization: DailyScheduleSummary['officeUtilization']): string {
    return `OFFICE UTILIZATION:\n${Array.from(utilization.entries()).map(([id, data]) =>
      `${id}: ${Math.round((data.bookedSlots / data.totalSlots) * 100)}%`
    ).join('\n')}\n\n`;
  }
}