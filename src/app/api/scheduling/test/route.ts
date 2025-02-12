// src/app/api/scheduling/test/route.ts

import { NextResponse } from 'next/server';
import { initializeGoogleSheets } from '@/lib/google/auth';
import { OfficeAssignmentService } from '@/lib/scheduling/office-assignment';
import type { SchedulingRequest } from '@/types/scheduling';

export async function POST(request: Request) {
  try {
    // Parse the request body
    const body = await request.json();
    const { newRequest, existingBookings = [] } = body;

    console.log('Processing test scheduling request:', {
      newRequest,
      existingBookingCount: existingBookings.length
    });

    // Initialize Google Sheets service
    const sheetsService = await initializeGoogleSheets();
    
    // Get offices and rules
    const [offices, rules] = await Promise.all([
      sheetsService.getOffices(),
      sheetsService.getAssignmentRules()
    ]);

    // Create bookings map
    const bookingsMap = new Map<string, SchedulingRequest[]>();
    existingBookings.forEach((booking: any) => {
      const officeId = booking.officeId;
      if (!bookingsMap.has(officeId)) {
        bookingsMap.set(officeId, []);
      }
      bookingsMap.get(officeId)?.push(booking);
    });

    // Initialize office assignment service
    const assignmentService = new OfficeAssignmentService(
      offices,
      rules,
      undefined, // No client preferences for test
      bookingsMap
    );

    // Find optimal office
    const result = await assignmentService.findOptimalOffice(newRequest);

    // Log the result to audit trail
    if (result.success) {
      await sheetsService.addAuditLog({
        timestamp: new Date().toISOString(),
        eventType: 'TEST_OFFICE_ASSIGNMENT',
        description: `Test assignment for client ${newRequest.clientId}`,
        user: 'SYSTEM',
        systemNotes: JSON.stringify({
          request: newRequest,
          result,
          existingBookings
        })
      });
    }

    return NextResponse.json({
      success: true,
      data: result
    });

  } catch (error) {
    console.error('Error in test scheduling:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error occurred',
        details: error
      },
      { status: 500 }
    );
  }
}