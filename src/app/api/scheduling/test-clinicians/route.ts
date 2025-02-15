// src/app/api/scheduling/test-clinicians/route.ts

import { NextResponse } from 'next/server';
import { initializeGoogleSheets } from '@/lib/google/auth';

export async function GET() {
  try {
    const sheetsService = await initializeGoogleSheets();
    const clinicians = await sheetsService.getClinicians();
    
    // Log each clinician's ID mapping
    console.log('Clinician ID Mappings:', 
      clinicians.map(c => ({
        clinicianId: c.clinicianId,
        name: c.name,
        intakeQId: c.intakeQPractitionerId
      }))
    );

    return NextResponse.json({
      success: true,
      data: clinicians
    });
  } catch (error) {
    console.error('Error fetching clinicians:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}