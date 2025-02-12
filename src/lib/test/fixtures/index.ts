// src/lib/test/fixtures/index.ts

import type { 
    AppointmentRecord,
    SchedulingRequest 
  } from '@/types/scheduling';
  import type { 
    SheetOffice,
    SheetClinician,
    ClientPreference 
  } from '@/types/sheets';
  import type { IntakeQWebhookPayload } from '@/types/webhooks';
  
  export const mockOffices: SheetOffice[] = [
    {
      officeId: 'B-A',
      name: 'Office B-A',
      unit: 'B',
      inService: true,
      floor: 'downstairs',
      isAccessible: true,
      size: 'medium',
      ageGroups: ['minor', 'adult'],
      specialFeatures: ['accessibility', 'group'],
      isFlexSpace: true
    },
    {
      officeId: 'C-1',
      name: 'Office C-1',
      unit: 'C',
      inService: true,
      floor: 'upstairs',
      isAccessible: false,
      size: 'large',
      ageGroups: ['adult'],
      specialFeatures: ['group'],
      primaryClinician: 'PRAC-001',
      isFlexSpace: false
    }
  ];
  
  export const mockClinicians: SheetClinician[] = [
    {
      clinicianId: 'PRAC-001',
      name: 'Dr. Smith',
      email: 'smith@example.com',
      role: 'clinician',
      ageRangeMin: 18,
      ageRangeMax: 65,
      specialties: ['anxiety', 'depression'],
      caseloadLimit: 25,
      currentCaseload: 20,
      preferredOffices: ['C-1'],
      allowsRelationship: true,
      certifications: ['LMFT'],
      intakeQPractitionerId: '64a319db9173cb32157ea065'
    }
  ];
  
  export const mockAppointments: AppointmentRecord[] = [
    {
      appointmentId: 'APT-001',
      clientId: 'TEST001',
      clinicianId: 'PRAC-001',
      officeId: 'B-A',
      sessionType: 'in-person',
      startTime: '2025-02-13T09:00:00Z',
      endTime: '2025-02-13T10:00:00Z',
      status: 'scheduled',
      lastUpdated: '2025-02-12T14:30:00Z',
      source: 'intakeq',
      requirements: {
        accessibility: false,
        specialFeatures: []
      }
    }
  ];
  
  export const mockClientPreferences: ClientPreference[] = [
    {
      clientId: 'TEST001',
      name: 'Test Client',
      email: 'test@example.com',
      mobilityNeeds: ['wheelchair'],
      sensoryPreferences: ['quiet'],
      physicalNeeds: [],
      roomConsistency: 4,
      supportNeeds: [],
      specialFeatures: ['accessibility', 'quiet'],
      lastUpdated: '2025-02-12T14:30:00Z',
      assignedOffice: 'B-A'
    }
  ];
  
  export const mockWebhookPayloads: Record<string, IntakeQWebhookPayload> = {
    appointmentCreated: {
      Type: 'Appointment Created',
      ClientId: 123,
      PracticeId: 'PRAC123',
      Appointment: {
        Id: 'APT-002',
        ClientId: 123,
        ClientName: 'Test Client',
        ClientEmail: 'test@example.com',
        PractitionerId: 'PRAC-001',
        StartDateIso: '2025-02-13T11:00:00Z',
        EndDateIso: '2025-02-13T12:00:00Z',
        Duration: 60,
        ServiceName: 'Individual Therapy',
        Status: 'scheduled',
        StartDate: 1676289600000,
        EndDate: 1676293200000,
        ServiceId: 'SVC001',
        PractitionerName: 'Dr. Smith',
        PractitionerEmail: 'smith@example.com',
        DateCreated: 1676289600000,
        CreatedBy: 'SYSTEM',
        BookedByClient: false,
        ClientDateOfBirth: '1990-01-01',
        ClientPhone: '123-456-7890',
        LocationName: 'Main Office',
        LocationId: 'LOC001',
        Price: 150,
        IntakeId: null,
        StartDateLocal: '2025-02-13T11:00:00',
        EndDateLocal: '2025-02-13T12:00:00',
        StartDateLocalFormatted: '11:00 AM'
      }
    },
    formSubmitted: {
      Type: 'Form Submitted',
      ClientId: 123,
      PracticeId: 'PRAC123',
      formId: '67a52367e11d09a2b82d57a9',
      responses: {
        clientName: 'Test Client',
        clientEmail: 'test@example.com',
        mobilityDevices: ['wheelchair'],
        sensoryPreferences: ['quiet'],
        roomConsistency: '1 - Strong preference for consistency'
      }
    }
  };