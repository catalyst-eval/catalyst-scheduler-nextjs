// src/types/webhooks.ts

export interface IntakeQAppointment {
  Id: string;
  ClientName: string;
  ClientEmail: string;
  ClientPhone: string;
  ClientDateOfBirth: string;
  ClientId: number;
  Status: string;
  StartDate: number;
  EndDate: number;
  Duration: number;
  ServiceName: string;
  ServiceId: string;
  LocationName: string;
  LocationId: string;
  Price: number;
  PractitionerName: string;
  PractitionerEmail: string;
  PractitionerId: string;
  IntakeId: string | null;
  DateCreated: number;
  CreatedBy: string;
  BookedByClient: boolean;
  ExternalClientId?: string;
  StartDateIso: string;
  EndDateIso: string;
  StartDateLocal: string;
  EndDateLocal: string;
  StartDateLocalFormatted: string;
  [key: string]: any; // For additional fields
}

export interface IntakeQWebhookPayload {
  IntakeId?: string;
  Type: 'Intake Submitted' | 'Appointment Created' | 'Appointment Updated' | 'Appointment Rescheduled' | 'Appointment Cancelled';
  ClientId: number;
  ExternalClientId?: string;
  PracticeId: string;
  ExternalPracticeId?: string | null;
  formId?: string;
  responses?: Record<string, any>;
  // Appointment specific fields
  EventType?: string;
  Appointment?: IntakeQAppointment;
  ActionPerformedByClient?: boolean;
}

export interface WebhookResponse {
  success: boolean;
  error?: string;
  data?: any;
}