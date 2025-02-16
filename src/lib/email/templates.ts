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

    const displayDate = new Date(summary.date).toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      timeZone: 'America/New_York'
    });
    let subject = `Daily Schedule - ${displayDate}`;
    if (hasHighPriorityAlerts) {
      subject = `⚠️ ${subject} - HIGH PRIORITY ALERTS`;
    } else if (hasConflicts) {
      subject = `⚠️ ${subject} - Conflicts Detected`;
    }
    return subject;
  }

  private static formatHtml(summary: DailyScheduleSummary): string {
    return `
      <div style="font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; line-height: 1.5;">
        <h1 style="color: #1e40af; margin-bottom: 1.5em;">Daily Schedule - ${summary.date}</h1>
        
        ${this.formatAlertsHtml(summary.alerts)}
        ${this.formatConflictsHtml(summary.conflicts)}
        
        <div style="margin: 2em 0;">
          <h2 style="color: #1e40af; margin-bottom: 1em;">Appointments</h2>
          <table style="width: 100%; border-collapse: collapse; margin-bottom: 2em;">
            <thead>
              <tr style="background-color: #dbeafe;">
                <th style="padding: 12px; text-align: left; border: 1px solid #bfdbfe; font-weight: 600;">Time</th>
                <th style="padding: 12px; text-align: left; border: 1px solid #bfdbfe; font-weight: 600;">Office</th>
                <th style="padding: 12px; text-align: left; border: 1px solid #bfdbfe; font-weight: 600;">Client</th>
                <th style="padding: 12px; text-align: left; border: 1px solid #bfdbfe; font-weight: 600;">Clinician</th>
                <th style="padding: 12px; text-align: left; border: 1px solid #bfdbfe; font-weight: 600;">Type</th>
              </tr>
            </thead>
            <tbody>
            ${summary.appointments
              .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
              .map(appt => `
                <tr>
                  <td style="padding: 12px; border: 1px solid #bfdbfe;">
                    ${this.formatAppointmentTime(appt.startTime)}
                  </td>
                    <td style="padding: 12px; border: 1px solid #bfdbfe;">
                      ${appt.officeId || 'TBD'}
                    </td>
                    <td style="padding: 12px; border: 1px solid #bfdbfe;">
            ${appt.clientName || `Client ${appt.clientId}`}
          </td>
          <td style="padding: 12px; border: 1px solid #bfdbfe;">
            ${appt.clinicianName || `Clinician ${appt.clinicianId}`}
          </td>
          <td style="padding: 12px; border: 1px solid #bfdbfe;">
            ${this.formatSessionType(appt.sessionType)}
          </td>
                  </tr>
                `).join('')}
            </tbody>
          </table>
        </div>

        <div style="margin: 2em 0;">
          <h2 style="color: #1e40af; margin-bottom: 1em;">Office Utilization</h2>
          <table style="width: 100%; border-collapse: collapse;">
            <thead>
              <tr style="background-color: #dbeafe;">
                <th style="padding: 12px; text-align: left; border: 1px solid #bfdbfe; font-weight: 600;">Office</th>
                <th style="padding: 12px; text-align: left; border: 1px solid #bfdbfe; font-weight: 600;">Usage</th>
                <th style="padding: 12px; text-align: left; border: 1px solid #bfdbfe; font-weight: 600;">Notes</th>
              </tr>
            </thead>
            <tbody>
              ${Array.from(summary.officeUtilization.entries()).map(([officeId, data]) => `
                <tr>
                  <td style="padding: 12px; border: 1px solid #bfdbfe;">${officeId}</td>
                  <td style="padding: 12px; border: 1px solid #bfdbfe;">
                    ${Math.round((data.bookedSlots / data.totalSlots) * 100)}%
                  </td>
                  <td style="padding: 12px; border: 1px solid #bfdbfe;">
                    ${data.specialNotes?.join(', ') || ''}
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>

        <div style="color: #6b7280; font-size: 12px; margin-top: 3em; border-top: 1px solid #e5e7eb; padding-top: 1em;">
          Generated ${new Date().toLocaleString()}
        </div>
      </div>
    `;
  }

  private static formatText(summary: DailyScheduleSummary): string {
    const lines: string[] = [
      `Daily Schedule - ${summary.date}`,
      '',
    ];

    // Add alerts
    if (summary.alerts.length > 0) {
      lines.push('ALERTS:');
      summary.alerts.forEach(alert => {
        lines.push(`${alert.type}: ${alert.message}`);
      });
      lines.push('');
    }

    // Add conflicts
    if (summary.conflicts.length > 0) {
      lines.push('CONFLICTS:');
      summary.conflicts.forEach(conflict => {
        lines.push(`${conflict.type}: ${conflict.description}`);
        if (conflict.officeId) {
          lines.push(`  Office: ${conflict.officeId}`);
        }
      });
      lines.push('');
    }

    // Add appointments
    lines.push('APPOINTMENTS:');
    const sortedAppointments = summary.appointments
      .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
    
    sortedAppointments.forEach(appt => {
      lines.push(
        `${this.formatAppointmentTime(appt.startTime)} | ` +
        `Office: ${appt.officeId || 'TBD'} | ` +
        `Client: ${appt.clientName || `Client ${appt.clientId}`} | ` +
        `Clinician: ${appt.clinicianName || `Clinician ${appt.clinicianId}`} | ` +
        `Type: ${this.formatSessionType(appt.sessionType)}`
      );
    });
    lines.push('');

    // Add office utilization
    lines.push('OFFICE UTILIZATION:');
    Array.from(summary.officeUtilization.entries()).forEach(([officeId, data]) => {
      const utilization = Math.round((data.bookedSlots / data.totalSlots) * 100);
      lines.push(
        `${officeId}: ${utilization}% ` +
        `${data.specialNotes?.length ? `(${data.specialNotes.join(', ')})` : ''}`
      );
    });

    lines.push('', `Generated ${new Date().toLocaleString()}`);

    return lines.join('\n');
  }

  private static formatSessionType(type: string): string {
    const types: Record<string, string> = {
      'in-person': 'In-Person',
      'telehealth': 'Telehealth',
      'group': 'Group',
      'family': 'Family'
    };
    return types[type] || type;
  }

  private static formatAppointmentTime(isoTime: string): string {
    // Convert UTC to local time
    const utcDate = new Date(isoTime);
    return utcDate.toLocaleTimeString('en-US', { 
      hour: 'numeric', 
      minute: '2-digit',
      hour12: true,
      timeZone: 'America/New_York'  // Use Eastern Time
    });
  }

  private static formatAlertsHtml(alerts: DailyScheduleSummary['alerts']): string {
    if (!alerts.length) return '';
    return `
      <div style="margin: 1.5em 0;">
        <h2 style="color: #1e40af; margin-bottom: 1em;">Alerts</h2>
        ${alerts.map(alert => `
          <div style="padding: 12px; margin: 8px 0; border-radius: 4px; 
               background-color: ${this.getAlertBackground(alert.severity)};">
            <strong style="color: ${this.getAlertColor(alert.severity)};">
              ${alert.type.toUpperCase()}:
            </strong> 
            ${alert.message}
          </div>
        `).join('')}
      </div>
    `;
  }

  private static formatConflictsHtml(conflicts: DailyScheduleSummary['conflicts']): string {
    if (!conflicts.length) return '';
    return `
      <div style="margin: 1.5em 0;">
        <h2 style="color: #1e40af; margin-bottom: 1em;">Conflicts</h2>
        ${conflicts.map(conflict => `
          <div style="padding: 12px; margin: 8px 0; border-radius: 4px; 
               background-color: ${this.getAlertBackground(conflict.severity)};">
            <strong style="color: ${this.getAlertColor(conflict.severity)};">
              ${conflict.type.toUpperCase()}
            </strong>
            <div>${conflict.description}</div>
            ${conflict.officeId ? `<div>Office: ${conflict.officeId}</div>` : ''}
          </div>
        `).join('')}
      </div>
    `;
  }

  private static getAlertBackground(severity: 'high' | 'medium' | 'low'): string {
    switch (severity) {
      case 'high':
        return '#fee2e2';  // Light red
      case 'medium':
        return '#fef3c7';  // Light yellow
      case 'low':
        return '#d1fae5';  // Light green
      default:
        return '#f3f4f6';  // Light gray
    }
  }

  private static getAlertColor(severity: 'high' | 'medium' | 'low'): string {
    switch (severity) {
      case 'high':
        return '#dc2626';  // Red
      case 'medium':
        return '#d97706';  // Yellow
      case 'low':
        return '#059669';  // Green
      default:
        return '#374151';  // Gray
    }
  }
}