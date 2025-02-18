// src/types/scheduling.ts

export type SessionType = 'in-person' | 'telehealth' | 'group' | 'family';
export type AppointmentSource = 'intakeq' | 'manual';
export type AlertSeverity = 'high' | 'medium' | 'low';

// Standard office ID format (e.g., 'B-a', 'A-c')
export type StandardOfficeId = `${Uppercase<string>}-${Lowercase<string>}`;

export interface AppointmentRecord {
  appointmentId: string;
  clientId: string;
  clientName: string;
  clinicianId: string;
  clinicianName: string;
  officeId: StandardOfficeId;
  sessionType: SessionType;
  startTime: string;
  endTime: string;
  status: 'scheduled' | 'completed' | 'cancelled' | 'rescheduled';
  lastUpdated: string;
  source: AppointmentSource;
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
    officeId?: StandardOfficeId;
    appointmentIds?: string[];
  }>;
  alerts: Array<{
    type: string;
    message: string;
    severity: AlertSeverity;
  }>;
  officeUtilization: Map<StandardOfficeId, {
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
    roomPreference?: StandardOfficeId;
    specialFeatures?: string[];
  };
}

export interface SchedulingResult {
  success: boolean;
  officeId?: StandardOfficeId;
  conflicts?: SchedulingConflict[];
  notes?: string;
  error?: string;
  evaluationLog?: string[];
}

export interface SchedulingConflict {
  officeId: StandardOfficeId;
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
    newOfficeId?: StandardOfficeId;
  };
}

export interface TimeSlotRequest {
  officeId: StandardOfficeId;
  dateTime: string;
  duration: number;
}

export interface ValidationResult {
  isValid: boolean;
  conflicts?: string[];
  error?: string;
}