// src/types/intakeq.ts

// Interface for appointments from IntakeQ
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
}

// Interface for office assignment requests
export interface AssignmentRequest {
    appointment: IntakeQAppointment;
    clientPreferences?: {
        mobilityNeeds: string[];
        sensoryPreferences: string[];
        physicalNeeds: string[];
        roomConsistency: number;
        supportNeeds: string[];
    };
    requirements?: {
        accessibility?: boolean;
        specialFeatures?: string[];
    };
}

// Interface for office assignment results
export interface AssignmentResult {
    success: boolean;
    appointmentId: string;
    officeId?: string;
    error?: string;
    notes?: string;
    evaluationLog?: string[];
}

// Interface for webhook payload from IntakeQ
export interface IntakeQWebhookPayload {
    IntakeId?: string;
    Type: 'Intake Submitted' | 'Appointment Created' | 'Appointment Updated';
    ClientId: number;
    ExternalClientId?: string;
    PracticeId: string;
    ExternalPracticeId?: string | null;
    formId?: string;
    responses?: Record<string, any>;
    Appointment?: IntakeQAppointment;
    ActionPerformedByClient?: boolean;
}

// Interface for notifications about office assignments
export interface AssignmentNotification {
    type: 'assignment' | 'reassignment' | 'error';
    appointmentId: string;
    officeId?: string;
    clinicianEmail: string;
    message: string;
    changes?: {
        previousOffice?: string;
        newOffice?: string;
        reason?: string;
    };
}