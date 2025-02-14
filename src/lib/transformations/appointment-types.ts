// src/lib/transformations/appointment-types.ts

import type { IntakeQAppointment } from '@/types/webhooks';
import type { 
  AppointmentRecord, 
  SessionType, 
  AlertSeverity 
} from '@/types/scheduling';

export const SESSION_TYPES = ['in-person', 'telehealth', 'group', 'family'] as const;
export const ALERT_SEVERITIES = ['high', 'medium', 'low'] as const;
export const APPOINTMENT_STATUSES = ['scheduled', 'completed', 'cancelled', 'rescheduled'] as const;

export type AppointmentStatus = typeof APPOINTMENT_STATUSES[number];
export type EmailPriority = 'high' | 'normal';

export function isSessionType(value: string): value is SessionType {
  return SESSION_TYPES.includes(value as SessionType);
}

export function isAlertSeverity(value: string): value is AlertSeverity {
  return ALERT_SEVERITIES.includes(value as AlertSeverity);
}

export function determineSessionType(serviceName: string): SessionType {
  const name = serviceName.toLowerCase();
  if (name.includes('telehealth') || name.includes('virtual')) return 'telehealth';
  if (name.includes('group')) return 'group';
  if (name.includes('family')) return 'family';
  return 'in-person';
}

export function mapAppointmentStatus(status: string): AppointmentStatus {
  const normalizedStatus = status.toLowerCase();
  switch (normalizedStatus) {
    case 'cancelled':
    case 'canceled':
      return 'cancelled';
    case 'completed':
    case 'done':
      return 'completed';
    case 'rescheduled':
      return 'rescheduled';
    default:
      return 'scheduled';
  }
}

export function mapEmailPriorityToAlertSeverity(priority: EmailPriority): AlertSeverity {
  switch (priority) {
    case 'high':
      return 'high';
    case 'normal':
      return 'medium';
  }
}

export function mapAlertSeverityToEmailPriority(severity: AlertSeverity): EmailPriority {
  switch (severity) {
    case 'high':
      return 'high';
    case 'medium':
    case 'low':
      return 'normal';
  }
}

export function transformIntakeQAppointment(appt: IntakeQAppointment): AppointmentRecord {
  return {
    appointmentId: appt.Id,
    clientId: appt.ClientId.toString(),
    clinicianId: appt.PractitionerId,
    officeId: '', // Default empty until assigned
    sessionType: determineSessionType(appt.ServiceName),
    requirements: {
      accessibility: false,
      specialFeatures: []
    },
    startTime: appt.StartDateIso,
    endTime: appt.EndDateIso,
    status: mapAppointmentStatus(appt.Status),
    lastUpdated: new Date(appt.DateCreated * 1000).toISOString(),
    source: 'intakeq' as const
  };
}