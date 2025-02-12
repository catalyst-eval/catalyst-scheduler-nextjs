// src/lib/scheduling/conflict-resolution.ts

import type { 
  SessionType,
  SchedulingRequest,
  SchedulingConflict
} from '@/types/scheduling';

import type { SheetOffice } from '@/types/sheets';

export class ConflictResolutionService {
  constructor(
    private readonly availableOffices: SheetOffice[],
    private readonly existingBookings: Map<string, SchedulingRequest[]> // officeId -> bookings
  ) {}

  /**
   * Get session priority level
   */
  private getSessionPriority(sessionType: SessionType): number {
    switch (sessionType) {
      case 'in-person':
        return 100; // Highest priority
      case 'group':
      case 'family':
        return 75;  // High priority but below individual in-person
      case 'telehealth':
        return 25;  // Lowest priority, can be relocated
      default:
        return 50;
    }
  }

  /**
   * Check if an office has conflicts with the requested time slot
   */
  public async checkConflicts(
    officeId: string,
    request: SchedulingRequest
  ): Promise<SchedulingConflict[]> {
    const conflicts: SchedulingConflict[] = [];
    const existingBookings = this.existingBookings.get(officeId) || [];

    const requestStart = new Date(request.dateTime).getTime();
    const requestEnd = requestStart + (request.duration * 60 * 1000);

    for (const booking of existingBookings) {
      const bookingStart = new Date(booking.dateTime).getTime();
      const bookingEnd = bookingStart + (booking.duration * 60 * 1000);

      // Check for time overlap
      if (requestStart < bookingEnd && requestEnd > bookingStart) {
        // We have a conflict
        const conflict: SchedulingConflict = {
          officeId,
          existingBooking: booking,
          resolution: await this.resolveConflict(booking, request)
        };
        conflicts.push(conflict);
      }
    }

    return conflicts;
  }

  /**
   * Attempt to resolve a scheduling conflict
   */
  private async resolveConflict(
    existingBooking: SchedulingRequest,
    newRequest: SchedulingRequest
  ): Promise<{ type: 'relocate' | 'cannot-relocate'; reason: string; newOfficeId?: string }> {
    const existingPriority = this.getSessionPriority(existingBooking.sessionType);
    const newPriority = this.getSessionPriority(newRequest.sessionType);

    // If new booking is lower priority, don't relocate existing
    if (newPriority <= existingPriority) {
      return {
        type: 'cannot-relocate',
        reason: `Existing ${existingBooking.sessionType} session has priority over new ${newRequest.sessionType} session`
      };
    }

    // Try to find alternative office for existing booking
    const alternativeOffice = await this.findAlternativeOffice(existingBooking);
    if (alternativeOffice) {
      return {
        type: 'relocate',
        reason: `${newRequest.sessionType} takes priority, relocating existing ${existingBooking.sessionType} to ${alternativeOffice.officeId}`,
        newOfficeId: alternativeOffice.officeId
      };
    }

    return {
      type: 'cannot-relocate',
      reason: 'No alternative offices available for relocation'
    };
  }

  /**
   * Find an alternative office for a booking
   */
  private async findAlternativeOffice(
    booking: SchedulingRequest
  ): Promise<SheetOffice | null> {
    // Filter available offices based on booking requirements
    const validOffices = this.availableOffices.filter(office => {
      // Must be in service
      if (!office.inService) return false;

      // Check accessibility if required
      if (booking.requirements?.accessibility && !office.isAccessible) {
        return false;
      }

      // Check if office already has conflicts
      const officeBookings = this.existingBookings.get(office.officeId) || [];
      const hasConflicts = officeBookings.some(existing => {
        const existingStart = new Date(existing.dateTime).getTime();
        const existingEnd = existingStart + (existing.duration * 60 * 1000);
        const bookingStart = new Date(booking.dateTime).getTime();
        const bookingEnd = bookingStart + (booking.duration * 60 * 1000);

        return bookingStart < existingEnd && bookingEnd > existingStart;
      });

      return !hasConflicts;
    });

    // Return first available office or null if none found
    return validOffices.length > 0 ? validOffices[0] : null;
  }
}