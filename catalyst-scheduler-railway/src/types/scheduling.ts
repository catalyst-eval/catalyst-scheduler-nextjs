// src/types/scheduling.ts

export type StandardOfficeId = string;

export interface AppointmentRecord {
  appointmentId: string;
  clientId: string;
  clientName: string;
  clinicianId: string;
  clinicianName: string;
  officeId: string;
  suggestedOfficeId?: string;
  sessionType: 'in-person' | 'telehealth' | 'group' | 'family';
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

// Utility function for standardizing office IDs
export function standardizeOfficeId(officeId: string): string {
  const cleaned = officeId.trim().toUpperCase();
  const match = cleaned.match(/^([A-Z])-?([A-Z])$/i);
  
  if (match) {
    return `${match[1]}-${match[2]}`;
  }
  
  return cleaned;
}