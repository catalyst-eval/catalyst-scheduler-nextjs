// src/lib/scheduling/office-assignment.ts

import type { 
  SheetOffice, 
  AssignmentRule, 
  ClientPreference
} from '@/types/sheets';

import type {
  SchedulingRequest,
  SchedulingResult,
  SchedulingConflict
} from '@/types/scheduling';

import { ConflictResolutionService } from './conflict-resolution';

interface RuleEvaluationResult {
  officeId: string;
  score: number;
  reasons: string[];
  isHardMatch: boolean;
  evaluationLog: string[];
  conflicts?: SchedulingConflict[];
}

export class OfficeAssignmentService {
  private conflictResolver: ConflictResolutionService;

  constructor(
    private readonly offices: SheetOffice[],
    private readonly rules: AssignmentRule[],
    private readonly clientPreferences?: ClientPreference,
    private readonly existingBookings: Map<string, SchedulingRequest[]> = new Map()
  ) {
    this.conflictResolver = new ConflictResolutionService(offices, existingBookings);
  }

  async findOptimalOffice(request: SchedulingRequest): Promise<SchedulingResult> {
    try {
      console.log('Starting office assignment for:', {
        clientId: request.clientId,
        clinicianId: request.clinicianId,
        sessionType: request.sessionType,
        clientAge: request.clientAge,
        requirements: request.requirements
      });

      // Get all valid offices based on hard requirements
      const validOffices = this.filterValidOffices(request);
      console.log(`Found ${validOffices.length} valid offices after basic filtering`);
      
      if (validOffices.length === 0) {
        return {
          success: false,
          error: 'No offices match the basic requirements'
        };
      }

      // Check for conflicts and potential resolutions
      const officeEvaluations = await Promise.all(
        validOffices.map(async (office) => {
          const conflicts = await this.conflictResolver.checkConflicts(
            office.officeId,
            request
          );

          // If there are unresolvable conflicts, mark this office as invalid
          const hasUnresolvableConflict = conflicts.some(
            conflict => conflict.resolution?.type === 'cannot-relocate'
          );

          if (hasUnresolvableConflict) {
            return null;
          }

          const evaluation = await this.evaluateOffice(office, request);
          return {
            ...evaluation,
            conflicts
          };
        })
      );

      // Filter out offices with unresolvable conflicts
      const validEvaluations = officeEvaluations.filter((result): result is (RuleEvaluationResult & { conflicts: SchedulingConflict[] }) => 
        result !== null
      );

      // Sort by score and filter for hard matches if any exist
      const hardMatches = validEvaluations.filter(result => result.isHardMatch);
      console.log(`Found ${hardMatches.length} hard matches`);

      const sortedEvaluations = hardMatches.length > 0 
        ? hardMatches 
        : validEvaluations;

      sortedEvaluations.sort((a, b) => b.score - a.score);

      if (sortedEvaluations.length === 0) {
        return {
          success: false,
          error: 'No suitable offices found after conflict resolution and rule evaluation'
        };
      }

      const bestMatch = sortedEvaluations[0];
      console.log('Best match found:', {
        officeId: bestMatch.officeId,
        score: bestMatch.score,
        reasons: bestMatch.reasons,
        conflicts: bestMatch.conflicts,
        evaluationLog: bestMatch.evaluationLog
      });
      
      return {
        success: true,
        officeId: bestMatch.officeId,
        conflicts: bestMatch.conflicts,
        notes: bestMatch.reasons.join('; '),
        evaluationLog: bestMatch.evaluationLog
      };
    } catch (error) {
      console.error('Error finding optimal office:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }

  private filterValidOffices(request: SchedulingRequest): SheetOffice[] {
    return this.offices.filter(office => {
      // Check if office is in service
      if (!office.inService) {
        console.log(`Office ${office.officeId} is not in service`);
        return false;
      }

      // Check accessibility requirements
      if (request.requirements?.accessibility && !office.isAccessible) {
        console.log(`Office ${office.officeId} does not meet accessibility requirements`);
        return false;
      }

      // Check if specific room was requested
      if (request.requirements?.roomPreference && 
          office.officeId !== request.requirements.roomPreference) {
        console.log(`Office ${office.officeId} does not match room preference`);
        return false;
      }

      // Check special features
      if (request.requirements?.specialFeatures) {
        const hasAllFeatures = request.requirements.specialFeatures.every(
          (feature: string) => office.specialFeatures.includes(feature)
        );
        if (!hasAllFeatures) {
          console.log(`Office ${office.officeId} missing required features`);
          return false;
        }
      }

      return true;
    });
  }

  private async evaluateOffice(
    office: SheetOffice, 
    request: SchedulingRequest
  ): Promise<RuleEvaluationResult> {
    const result: RuleEvaluationResult = {
      officeId: office.officeId,
      score: 0,
      reasons: [],
      isHardMatch: false,
      evaluationLog: [`Starting evaluation for office ${office.officeId}`]
    };

    // Sort rules by priority
    const sortedRules = [...this.rules]
      .filter(rule => rule.active)
      .sort((a, b) => a.priority - b.priority);

    for (const rule of sortedRules) {
      const { score, log } = await this.evaluateRule(rule, office, request);
      result.evaluationLog.push(...log);
      
      if (score > 0) {
        result.score += score;
        result.reasons.push(`Matches ${rule.ruleName}`);
        
        if (rule.overrideLevel === 'hard') {
          result.isHardMatch = true;
          result.evaluationLog.push(`Hard match found for rule: ${rule.ruleName}`);
        }
      }
    }

    // Evaluate client preferences
    if (this.clientPreferences) {
      const { prefScore, prefLog } = this.evaluateClientPreferences(office);
      result.score += prefScore;
      result.evaluationLog.push(...prefLog);
      if (prefScore > 0) {
        result.reasons.push('Matches client preferences');
      }
    }

    result.evaluationLog.push(`Final score for ${office.officeId}: ${result.score}`);
    return result;
  }

  /**
   * Evaluate a single rule for an office
   */
  private async evaluateRule(
    rule: AssignmentRule,
    office: SheetOffice,
    request: SchedulingRequest
  ): Promise<{ score: number; log: string[] }> {
    const log: string[] = [];
    log.push(`Evaluating rule: ${rule.ruleName} (${rule.ruleType})`);

    // Check if office is in the rule's office list
    if (!rule.officeIds.includes(office.officeId)) {
      log.push(`Office ${office.officeId} not in rule's office list`);
      return { score: 0, log };
    }

    let score = 0;
    switch (rule.ruleType) {
      case 'accessibility':
        score = this.evaluateAccessibilityRule(rule, office, request);
        log.push(`Accessibility score: ${score}`);
        break;

      case 'age_group':
        score = this.evaluateAgeGroupRule(rule, office, request);
        log.push(`Age group score: ${score}`);
        break;

      case 'clinician_primary':
        score = this.evaluatePrimaryClinicianRule(rule, office, request);
        log.push(`Primary clinician score: ${score}`);
        break;

      case 'clinician_alternative':
        score = this.evaluateAlternativeClinicianRule(rule, office, request);
        log.push(`Alternative clinician score: ${score}`);
        break;

      case 'room_type':
        score = this.evaluateRoomTypeRule(rule, office, request);
        log.push(`Room type score: ${score}`);
        break;

      default:
        log.push(`Unknown rule type: ${rule.ruleType}`);
    }

    log.push(`Final score for rule: ${score}`);
    return { score, log };
  }

  /**
   * Evaluate age group rules
   */
  private evaluateAgeGroupRule(
    rule: AssignmentRule,
    office: SheetOffice,
    request: SchedulingRequest
  ): number {
    if (!request.clientAge) return 0;

    const condition = rule.condition;
    if (condition.includes('<=')) {
      const maxAge = parseInt(condition.split('<=')[1].trim());
      if (request.clientAge <= maxAge) {
        return rule.overrideLevel === 'hard' ? 1000 : 100;
      }
    } else if (condition.includes('&&')) {
      const [minStr, maxStr] = condition.split('&&');
      const minAge = parseInt(minStr.split('>')[1].trim());
      const maxAge = parseInt(maxStr.split('<=')[1].trim());
      if (request.clientAge > minAge && request.clientAge <= maxAge) {
        return rule.overrideLevel === 'hard' ? 1000 : 100;
      }
    }
    return 0;
  }

  /**
   * Evaluate accessibility rules
   */
  private evaluateAccessibilityRule(
    rule: AssignmentRule,
    office: SheetOffice,
    request: SchedulingRequest
  ): number {
    if (!request.requirements?.accessibility) return 0;
    
    if (office.isAccessible) {
      return rule.overrideLevel === 'hard' ? 1000 : 100;
    }
    
    return 0;
  }

  /**
   * Evaluate primary clinician rules
   */
  private evaluatePrimaryClinicianRule(
    rule: AssignmentRule,
    office: SheetOffice,
    request: SchedulingRequest
  ): number {
    if (office.primaryClinician === request.clinicianId) {
      return rule.overrideLevel === 'hard' ? 500 : 100;
    }
    return 0;
  }

  /**
   * Evaluate alternative clinician rules
   */
  private evaluateAlternativeClinicianRule(
    rule: AssignmentRule,
    office: SheetOffice,
    request: SchedulingRequest
  ): number {
    const clinicians = rule.condition.split('=')[1].trim()
      .replace(/['"]/g, '')
      .split(',')
      .map(c => c.trim());

    if (clinicians.includes(request.clinicianId)) {
      return rule.overrideLevel === 'hard' ? 250 : 50;
    }
    return 0;
  }

  /**
   * Evaluate room type rules
   */
  private evaluateRoomTypeRule(
    rule: AssignmentRule,
    office: SheetOffice,
    request: SchedulingRequest
  ): number {
    if (request.sessionType === 'group' && office.specialFeatures.includes('group')) {
      return rule.overrideLevel === 'hard' ? 300 : 75;
    }
    return 0;
  }

  /**
   * Evaluate client preferences for an office
   */
  private evaluateClientPreferences(office: SheetOffice): { prefScore: number; prefLog: string[] } {
    if (!this.clientPreferences) return { prefScore: 0, prefLog: ['No client preferences available'] };
    
    const prefLog: string[] = ['Evaluating client preferences'];
    let prefScore = 0;

    // Check if this is their previously assigned office
    if (this.clientPreferences.assignedOffice === office.officeId) {
      const roomScore = this.clientPreferences.roomConsistency * 10;
      prefScore += roomScore;
      prefLog.push(`Previous office match score: ${roomScore}`);
    }

    // Check if office meets mobility needs
    if (this.clientPreferences.mobilityNeeds.length > 0 && office.isAccessible) {
      prefScore += 50;
      prefLog.push('Mobility needs score: 50');
    }

    // Check if office has required features for sensory preferences
    const hasRequiredFeatures = this.clientPreferences.sensoryPreferences.every(
      pref => office.specialFeatures.includes(pref)
    );
    if (hasRequiredFeatures) {
      prefScore += 30;
      prefLog.push('Sensory preferences score: 30');
    }

    prefLog.push(`Total preference score: ${prefScore}`);
    return { prefScore, prefLog };
  }
}