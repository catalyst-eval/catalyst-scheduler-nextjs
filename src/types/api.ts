import type { IntakeQAppointment } from './webhooks';

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  timestamp: string;
}

export interface AppointmentConflict {
  type: 'double-booking' | 'capacity' | 'accessibility';
  description: string;
  severity: 'high' | 'medium' | 'low';
  officeId?: string;
  appointmentIds?: string[];
}

export interface ValidationResponse {
  isValid: boolean;
  conflicts: AppointmentConflict[];
  error?: string;
}

export interface SchedulingResponse extends ApiResponse<{
  appointmentId: string;
  officeId?: string;
  action: string;
  conflicts?: AppointmentConflict[];
}> {}

export interface DailySyncResponse extends ApiResponse<{
  date: string;
  appointmentCount: number;
  conflicts: AppointmentConflict[];
  alerts: Array<{
    type: string;
    message: string;
    severity: 'high' | 'medium' | 'low';
  }>;
}> {}