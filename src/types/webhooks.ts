// src/types/webhooks.ts

export type WebhookEventType = 
  | 'Form Submitted'
  | 'Intake Submitted'
  | 'Appointment Created'
  | 'Appointment Updated'
  | 'Appointment Rescheduled'
  | 'Appointment Cancelled';

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
  CancellationReason?: string;
  RecurrencePattern?: {
    frequency: 'weekly' | 'biweekly' | 'monthly';
    occurrences: number;
    endDate?: string;
  };
  [key: string]: any;
}

export interface IntakeQWebhookPayload {
  IntakeId?: string;
  Type: WebhookEventType;
  ClientId: number;
  ExternalClientId?: string;
  PracticeId: string;
  ExternalPracticeId?: string | null;
  formId?: string;
  responses?: Record<string, any>;
  EventType?: string;
  Appointment?: IntakeQAppointment;
  ActionPerformedByClient?: boolean;
}

export interface WebhookResponse {
  success: boolean;
  error?: string;
  details?: any;
}

export class WebhookError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number = 500,
    public readonly details?: any
  ) {
    super(message);
    this.name = 'WebhookError';
  }
}