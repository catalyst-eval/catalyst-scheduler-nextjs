// src/app/api/scheduling/assign/route.ts

import { NextResponse } from 'next/server';
import { initializeGoogleSheets } from '@/lib/google/auth';
import { OfficeAssignmentService } from '@/lib/scheduling/office-assignment';
import type { SchedulingRequest } from '@/types/scheduling';

export async function POST(request: Request) {
  try {
    // Parse request body
    const body = await request.json();
    const schedulingRequest = body as SchedulingRequest;

    // Validate required fields
    if (!schedulingRequest.clientId || !schedulingRequest.clinicianId) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Initialize Google Sheets service
    const sheetsService = await initializeGoogleSheets();

    // Fetch required data
    const [offices, rules, preferences] = await Promise.all([
      sheetsService.getOffices(),
      sheetsService.getAssignmentRules(),
      sheetsService.getClientPreferences()
    ]);

    // Find client preferences if they exist
    const clientPreference = preferences.find(
      pref => pref.clientId === schedulingRequest.clientId
    );

    // Create assignment service
    const assignmentService = new OfficeAssignmentService(
      offices,
      rules,
      clientPreference
    );

    // Find optimal office
    const result = await assignmentService.findOptimalOffice(schedulingRequest);

    if (!result.success) {
      return NextResponse.json(
        { error: result.error },
        { status: 400 }
      );
    }

    // Log the assignment in audit trail
    await sheetsService.addAuditLog({
      timestamp: new Date().toISOString(),
      eventType: 'OFFICE_ASSIGNED',
      description: `Assigned office ${result.officeId} to client ${schedulingRequest.clientId}`,
      user: 'SYSTEM',
      systemNotes: result.notes
    });

    return NextResponse.json({
      success: true,
      data: result
    });

  } catch (error) {
    console.error('Error in office assignment:', error);
    return NextResponse.json(
      { 
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      },
      { status: 500 }
    );
  }
}