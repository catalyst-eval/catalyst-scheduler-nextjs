// src/app/api/scheduling/validate/route.ts

import { NextResponse } from 'next/server';
import { initializeGoogleSheets } from '@/lib/google/auth';
import { DailyAssignmentService } from '@/lib/scheduling/daily-assignment-service';
import type { SchedulingRequest } from '@/types/scheduling';

export async function POST(request: Request) {
  try {
    const schedulingRequest: SchedulingRequest = await request.json();

    // Initialize services
    const sheetsService = await initializeGoogleSheets();
    const assignmentService = new DailyAssignmentService(sheetsService);

    // Get the date from the scheduling request
    const requestDate = new Date(schedulingRequest.dateTime).toISOString().split('T')[0];

    // Generate summary for the day
    const summary = await assignmentService.generateDailySummary(requestDate);

    // Check for potential conflicts
    const conflicts = [];

    // Check clinician double-booking
    const clinicianConflicts = summary.appointments.filter(appt => {
      if (appt.clinicianId !== schedulingRequest.clinicianId) return false;

      const apptStart = new Date(appt.startTime);
      const apptEnd = new Date(appt.endTime);
      const requestStart = new Date(schedulingRequest.dateTime);
      const requestEnd = new Date(
        requestStart.getTime() + (schedulingRequest.duration * 60000)
      );

      return requestStart < apptEnd && requestEnd > apptStart;
    });

    if (clinicianConflicts.length > 0) {
      conflicts.push({
        type: 'clinician_conflict',
        severity: 'high',
        description: 'Clinician is already booked during this time',
        details: clinicianConflicts.map(appt => ({
          appointmentId: appt.appointmentId,
          startTime: appt.startTime,
          endTime: appt.endTime
        }))
      });
    }

    // Check office capacity
    const officeUtilization = new Map(summary.officeUtilization);
    for (const [officeId, data] of officeUtilization) {
      if (data.bookedSlots / data.totalSlots > 0.9) {
        conflicts.push({
          type: 'capacity_warning',
          severity: 'medium',
          description: `Office ${officeId} is near capacity`,
          details: {
            officeId,
            utilization: Math.round((data.bookedSlots / data.totalSlots) * 100)
          }
        });
      }
    }

    // Get client preferences
    const clientPreferences = await sheetsService.getClientPreferences();
    const clientPref = clientPreferences.find(
      pref => pref.clientId === schedulingRequest.clientId
    );

    if (clientPref) {
      // Check accessibility requirements
      if (clientPref.mobilityNeeds.length > 0) {
        const offices = await sheetsService.getOffices();
        const accessibleOffices = offices.filter(office => office.isAccessible);
        
        if (accessibleOffices.length === 0) {
          conflicts.push({
            type: 'accessibility_requirement',
            severity: 'high',
            description: 'Client requires accessible office but none are available',
            details: {
              mobilityNeeds: clientPref.mobilityNeeds
            }
          });
        }
      }

      // Check room consistency preference
      if (clientPref.roomConsistency >= 4 && clientPref.assignedOffice) {
        // High preference for consistency, flag if different office
        const offices = await sheetsService.getOffices();
        const preferredOffice = offices.find(
          office => office.officeId === clientPref.assignedOffice
        );

        if (preferredOffice) {
          conflicts.push({
            type: 'room_consistency',
            severity: 'medium',
            description: 'Client has strong preference for consistent room assignment',
            details: {
              preferredOffice: preferredOffice.officeId,
              roomConsistency: clientPref.roomConsistency
            }
          });
        }
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        hasConflicts: conflicts.length > 0,
        conflicts,
        scheduling: {
          date: requestDate,
          totalAppointments: summary.appointments.length,
          officeUtilization: Array.from(officeUtilization.entries()).map(
            ([officeId, data]) => ({
              officeId,
              ...data
            })
          )
        }
      }
    });

  } catch (error) {
    console.error('Error validating schedule:', error);

    return NextResponse.json(
      {
        success: false,
        error: 'Failed to validate schedule request',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}