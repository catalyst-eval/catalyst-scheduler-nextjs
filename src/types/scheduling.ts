// src/types/scheduling.ts

export type SessionType = 'in-person' | 'telehealth' | 'group' | 'family';
export type SessionPriority = 'high' | 'medium' | 'low';
export type AlertSeverity = 'high' | 'medium' | 'low';

export interface AppointmentRecord {
  appointmentId: string;
  clientId: string;
  clinicianId: string;
  officeId: string;
  sessionType: SessionType;
  startTime: string;
  endTime: string;
  status: 'scheduled' | 'completed' | 'cancelled' | 'rescheduled';
  lastUpdated: string;
  source: 'intakeq' | 'manual';
  requirements?: {
    accessibility?: boolean;
    specialFeatures?: string[];
  };
  notes?: string;
}

export interface DailyScheduleSummary {
  date: string;
  appointments: AppointmentRecord[];
  conflicts: Array<{
    type: string;
    description: string;
    severity: AlertSeverity;
    officeId?: string;
    appointmentIds?: string[];
  }>;
  alerts: Array<{
    type: string;
    message: string;
    severity: AlertSeverity;
  }>;
  officeUtilization: Map<string, {
    totalSlots: number;
    bookedSlots: number;
    specialNotes?: string[];
  }>;
}

export interface SchedulingRequest {
  clientId: string;
  clinicianId: string;
  dateTime: string;
  duration: number;
  sessionType: SessionType;
  clientAge?: number;
  requirements?: {
    accessibility?: boolean;
    roomPreference?: string;
    specialFeatures?: string[];
  };
}

export interface SchedulingResult {
  success: boolean;
  officeId?: string;
  conflicts?: SchedulingConflict[];
  notes?: string;
  error?: string;
  evaluationLog?: string[];
}

export interface SchedulingConflict {
  officeId: string;
  existingBooking: {
    clientId: string;
    clinicianId: string;
    sessionType: SessionType;
    dateTime: string;
    duration: number;
  };
  resolution?: {
    type: 'relocate' | 'cannot-relocate';
    reason: string;
    newOfficeId?: string;
  };
}

export interface TimeSlotRequest {
  officeId: string;
  dateTime: string;
  duration: number;
}

export interface ValidationResult {
  isValid: boolean;
  conflicts?: string[];
  error?: string;
}