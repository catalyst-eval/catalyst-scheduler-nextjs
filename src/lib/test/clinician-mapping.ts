// src/lib/test/clinician-mapping.ts
import { GoogleSheetsService } from '../google/sheets';

export async function testClinicianMapping(
  sheetsService: GoogleSheetsService,
  practitionerId: string
): Promise<{
  found: boolean;
  practitionerId: string;
  matchedClinician?: {
    clinicianId: string;
    name: string;
    intakeQPractitionerId: string;
  };
  allClinicians: Array<{
    clinicianId: string;
    name: string;
    intakeQPractitionerId: string;
  }>;
}> {
  // Get all clinicians
  const clinicians = await sheetsService.getClinicians();
  
  // Log all clinician data for debugging
  console.log('All clinicians:', clinicians.map(c => ({
    clinicianId: c.clinicianId,
    name: c.name,
    intakeQId: c.intakeQPractitionerId
  })));

  // Find matching clinician
  const matchedClinician = clinicians.find(
    c => c.intakeQPractitionerId === practitionerId
  );

  // Return test results
  return {
    found: !!matchedClinician,
    practitionerId,
    matchedClinician: matchedClinician ? {
      clinicianId: matchedClinician.clinicianId,
      name: matchedClinician.name,
      intakeQPractitionerId: matchedClinician.intakeQPractitionerId
    } : undefined,
    allClinicians: clinicians.map(c => ({
      clinicianId: c.clinicianId,
      name: c.name,
      intakeQPractitionerId: c.intakeQPractitionerId
    }))
  };
}