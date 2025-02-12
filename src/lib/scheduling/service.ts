// src/lib/scheduling/service.ts

import { GoogleSheetsService } from '../google/sheets';
import type { 
  SheetOffice, 
  AssignmentRule,
  ClientPreference,
} from '@/types/sheets';

// Scheduling Types
interface SchedulingRequest {
  clientId: string;
  clinicianId: string;
  dateTime: string;
  duration: number;
  sessionType: string;
  requirements?: {
    accessibility?: boolean;
    roomPreference?: string;
    specialFeatures?: string[];
  };
}

interface SchedulingResult {
  success: boolean;
  officeId?: string;
  conflicts?: string[];
  notes?: string;
  error?: string;
}

export class SchedulingService {
  private sheetsService: GoogleSheetsService;

  constructor(sheetsService: GoogleSheetsService) {
    this.sheetsService = sheetsService;
  }

  /**
   * Find the optimal office assignment based on business rules and constraints
   */
  async findOptimalOffice(request: SchedulingRequest): Promise<SchedulingResult> {
    try {
      // Get all active data needed for assignment
      const [offices, rules, clientPrefs] = await Promise.all([
        this.sheetsService.getOffices(),
        this.sheetsService.getAssignmentRules(),
        this.sheetsService.getClientPreferences()
      ]);

      // Filter to only in-service offices
      const availableOffices = offices.filter(office => office.inService);
      
      // Get client preferences if they exist
      const clientPref = clientPrefs.find(p => p.clientId === request.clientId);

      // Sort rules by priority (highest first)
      const sortedRules = rules
        .filter(rule => rule.active)
        .sort((a, b) => b.priority - a.priority);

      // Apply rules to find matching offices
      const matches = this.applyRules(request, availableOffices, sortedRules, clientPref);

      if (matches.length === 0) {
        return {
          success: false,
          error: 'No suitable offices found matching requirements'
        };
      }

      // Select best match based on scoring
      const bestMatch = this.scoreCandidates(matches, request, clientPref);

      // Log the assignment decision
      await this.logAssignment(bestMatch, request);

      return {
        success: true,
        officeId: bestMatch.officeId
      };

    } catch (error) {
      console.error('Error in findOptimalOffice:', error);
      return {
        success: false,
        error: 'Failed to process office assignment'
      };
    }
  }

  /**
   * Apply business rules to filter available offices
   */
  private applyRules(
    request: SchedulingRequest,
    offices: SheetOffice[],
    rules: AssignmentRule[],
    clientPref?: ClientPreference
  ): SheetOffice[] {
    let candidates = [...offices];

    // Apply each rule in priority order
    for (const rule of rules) {
      const beforeCount = candidates.length;
      
      switch (rule.ruleType) {
        case 'accessibility':
          if (request.requirements?.accessibility || clientPref?.mobilityNeeds?.length) {
            candidates = candidates.filter(o => o.isAccessible);
          }
          break;

        case 'fixed':
          // Handle fixed office assignments (e.g. specific clinician must use specific office)
          if (rule.condition.includes(request.clinicianId)) {
            candidates = candidates.filter(o => rule.officeIds.includes(o.officeId));
          }
          break;

        case 'room_consistency':
          // Honor room consistency requirements if specified
          if (clientPref?.roomConsistency && clientPref.roomConsistency >= 4) {
            const preferredOffice = clientPref.assignedOffice;
            if (preferredOffice) {
              candidates = candidates.filter(o => o.officeId === preferredOffice);
            }
          }
          break;

        case 'special_features':
          // Match required special features
          if (request.requirements?.specialFeatures?.length) {
            candidates = candidates.filter(o => 
              request.requirements?.specialFeatures?.every((feature: string) => 
                o.specialFeatures.includes(feature)
              )
            );
          }
          break;
      }

      // If rule is 'hard' and filtered out all offices, return empty to force failure
      if (rule.overrideLevel === 'hard' && beforeCount > 0 && candidates.length === 0) {
        return [];
      }
    }

    return candidates;
  }

  /**
   * Score candidate offices to find best match
   */
  private scoreCandidates(
    offices: SheetOffice[], 
    request: SchedulingRequest,
    clientPref?: ClientPreference
  ): SheetOffice {
    const scored = offices.map(office => {
      let score = 0;

      // Prefer offices that match client preferences
      if (clientPref?.assignedOffice === office.officeId) {
        score += 5;
      }

      // Prefer offices assigned to the clinician
      if (office.primaryClinician === request.clinicianId) {
        score += 3;
      }
      if (office.alternativeClinicians?.includes(request.clinicianId)) {
        score += 2;
      }

      // Consider special features matches
      const requestedFeatures = request.requirements?.specialFeatures || [];
      const matchingFeatures = requestedFeatures.filter((feature: string) => 
        office.specialFeatures.includes(feature)
      ).length;
      score += matchingFeatures;

      return { office, score };
    });

    // Return office with highest score
    return scored.sort((a, b) => b.score - a.score)[0].office;
  }

  /**
   * Log assignment decision to audit log
   */
  private async logAssignment(
    office: SheetOffice,
    request: SchedulingRequest
  ): Promise<void> {
    await this.sheetsService.addAuditLog({
      timestamp: new Date().toISOString(),
      eventType: 'OFFICE_ASSIGNMENT',
      description: `Assigned office ${office.officeId} to client ${request.clientId}`,
      user: 'SYSTEM',
      systemNotes: `Clinician: ${request.clinicianId}, DateTime: ${request.dateTime}`
    });
  }
}