// src/app/api/scheduling/clinicians/route.ts

import { NextResponse } from 'next/server';
import { initializeGoogleSheets } from '@/lib/google/auth';

export async function GET() {
  try {
    const sheetsService = await initializeGoogleSheets();
    const clinicians = await sheetsService.getClinicians();

    return NextResponse.json({
      success: true,
      clinicians: clinicians.map(c => ({
        clinicianId: c.clinicianId,
        name: c.name,
        intakeQPractitionerId: c.intakeQPractitionerId,
        role: c.role,
        preferredOffices: c.preferredOffices
      }))
    });

  } catch (error) {
    console.error('Error fetching clinicians:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : 'Failed to fetch clinicians'
      },
      { status: 500 }
    );
  }
}