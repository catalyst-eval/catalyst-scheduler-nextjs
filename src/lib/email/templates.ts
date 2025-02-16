// src/lib/email/templates.ts

import type { DailyScheduleSummary } from '@/types/scheduling';
import { toEST, getDisplayDate, formatDateRange } from '../util/date-helpers';

export interface EmailTemplate {
  subject: string;
  html: string;
  text: string;
}

export class EmailTemplates {
  static dailySchedule(summary: DailyScheduleSummary): EmailTemplate {
    const displayDate = new Date(summary.date).toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      timeZone: 'America/New_York'
    });
    const hasHighPriorityAlerts = summary.alerts.some(a => a.severity === 'high');

    return {
      subject: this.formatSubject(displayDate, summary),
      html: this.formatHtml(displayDate, summary),
      text: this.formatText(displayDate, summary)
    };
  }

  private static formatSubject(displayDate: string, summary: DailyScheduleSummary): string {
    const hasHighPriorityAlerts = summary.alerts.some(a => a.severity === 'high');
    const hasConflicts = summary.conflicts.length > 0;

    let subject = `Daily Schedule - ${displayDate}`;
    if (hasHighPriorityAlerts) {
      subject = `⚠️ ${subject} - HIGH PRIORITY ALERTS`;
    } else if (hasConflicts) {
      subject = `⚠️ ${subject} - Conflicts Detected`;
    }
    return subject;
  }

  private static formatHtml(displayDate: string, summary: DailyScheduleSummary): string {
    return `
      <div style="font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; line-height: 1.5;">
        <h1 style="color: #1e40af; margin-bottom: 1.5em;">Daily Schedule - ${displayDate}</h1>
        
        ${this.formatAlertsHtml(summary.alerts)}
        ${this.formatConflictsHtml(summary.conflicts)}
        
        <div style="margin: 2em 0;">
          <h2 style="color: #1e40af; margin-bottom: 1em;">Appointments</h2>
          ${summary.appointments.length === 0 ? 
            `<p style="color: #666;">No appointments scheduled for ${displayDate}.</p>` :
            this.formatAppointmentsTable(summary.appointments)
          }
        </div>

        <div style="margin: 2em 0;">
          <h2 style="color: #1e40af; margin-bottom: 1em;">Office Utilization</h2>
          ${this.formatOfficeUtilization(summary.officeUtilization)}
        </div>

        <div style="color: #6b7280; font-size: 12px; margin-top: 3em; border-top: 1px solid #e5e7eb; padding-top: 1em;">
          Generated ${new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })}
        </div>
      </div>
    `;
  }

  private static formatText(displayDate: string, summary: DailyScheduleSummary): string {
    const lines: string[] = [
      `Daily Schedule - ${displayDate}`,
      '',
    ];

    // Add alerts
    if (summary.alerts.length > 0) {
      lines.push('ALERTS:');
      summary.alerts.forEach(alert => {
        lines.push(`[${alert.severity.toUpperCase()}] ${alert.type}: ${alert.message}`);
      });
      lines.push('');
    }

    // Add conflicts
    if (summary.conflicts.length > 0) {
      lines.push('CONFLICTS:');
      summary.conflicts.forEach(conflict => {
        lines.push(`[${conflict.severity.toUpperCase()}] ${conflict.type}: ${conflict.description}`);
      });
      lines.push('');
    }

    // Add appointments
    lines.push('APPOINTMENTS:');
    if (summary.appointments.length === 0) {
      lines.push('No appointments scheduled for this day.');
    } else {
      summary.appointments
        .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
        .forEach(appt => {
          lines.push(
            `${formatDateRange(appt.startTime, appt.endTime)} - ` +
            `${appt.clientName} with ${appt.clinicianName} ` +
            `(${appt.sessionType}${appt.officeId ? ` in ${appt.officeId}` : ''})`
          );
        });
    }
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

    lines.push('');
    lines.push(`Generated ${new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })}`);

    return lines.join('\n');
  }

  private static formatAppointmentsTable(appointments: DailyScheduleSummary['appointments'], displayDate?: string): string {
    return `
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 2em;">
        <thead>
          <tr style="background-color: #dbeafe;">
            <th style="padding: 12px; text-align: left; border: 1px solid #bfdbfe; font-weight: 600;">Time</th>
            <th style="padding: 12px; text-align: left; border: 1px solid #bfdbfe; font-weight: 600;">Client</th>
            <th style="padding: 12px; text-align: left; border: 1px solid #bfdbfe; font-weight: 600;">Clinician</th>
            <th style="padding: 12px; text-align: left; border: 1px solid #bfdbfe; font-weight: 600;">Type</th>
            <th style="padding: 12px; text-align: left; border: 1px solid #bfdbfe; font-weight: 600;">Office</th>
          </tr>
        </thead>
        <tbody>
          ${appointments
            .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
            .map((appt, index) => `
              <tr style="background-color: ${index % 2 === 0 ? '#f8fafc' : 'white'}">
                <td style="padding: 12px; border: 1px solid #bfdbfe;">
                  ${formatDateRange(appt.startTime, appt.endTime)}
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
                <td style="padding: 12px; border: 1px solid #bfdbfe;">
                  ${appt.officeId || 'TBD'}
                </td>
              </tr>
            `).join('')}
        </tbody>
      </table>
    `;
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

  private static formatOfficeUtilization(utilization: DailyScheduleSummary['officeUtilization']): string {
    return `
      <table style="width: 100%; border-collapse: collapse;">
        <thead>
          <tr style="background-color: #dbeafe;">
            <th style="padding: 12px; text-align: left; border: 1px solid #bfdbfe; font-weight: 600;">Office</th>
            <th style="padding: 12px; text-align: left; border: 1px solid #bfdbfe; font-weight: 600;">Usage</th>
            <th style="padding: 12px; text-align: left; border: 1px solid #bfdbfe; font-weight: 600;">Notes</th>
          </tr>
        </thead>
        <tbody>
          ${Array.from(utilization.entries()).map(([officeId, data], index) => `
            <tr style="background-color: ${index % 2 === 0 ? '#f8fafc' : 'white'}">
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
    `;
  }
}