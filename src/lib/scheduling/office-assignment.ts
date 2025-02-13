import type { 
  SheetOffice, 
  AssignmentRule, 
  ClientPreference,
  SheetClinician
} from '@/types/sheets';

import type {
  SchedulingRequest,
  SchedulingResult,
  SchedulingConflict
} from '@/types/scheduling';

interface RuleEvaluationResult {
  score: number;
  reason: string;
  log: string[];
}

interface OfficeScore {
  office: SheetOffice;
  score: number;
  reasons: string[];
  conflicts: SchedulingConflict[];
  log: string[];
}

export class OfficeAssignmentService {
  constructor(
    private readonly offices: SheetOffice[],
    private readonly rules: AssignmentRule[],
    private readonly clinicians: SheetClinician[],
    private readonly clientPreference?: ClientPreference,
    private readonly existingBookings: Map<string, SchedulingRequest[]> = new Map()
  ) {}

  async findOptimalOffice(request: SchedulingRequest): Promise<SchedulingResult> {
    const log: string[] = [`Starting office assignment for request: ${JSON.stringify(request)}`];
    
    try {
      // 1. Get clinician details
      const clinician = this.clinicians.find(c => c.clinicianId === request.clinicianId);
      if (!clinician) {
        throw new Error(`Clinician ${request.clinicianId} not found`);
      }
      log.push(`Found clinician: ${clinician.name} (${clinician.role})`);

      // 2. Filter valid offices based on basic requirements
      const validOffices = this.filterValidOffices(request, clinician);
      log.push(`Found ${validOffices.length} initially valid offices`);

      if (validOffices.length === 0) {
        return {
          success: false,
          error: 'No offices match basic requirements',
          evaluationLog: log
        };
      }

      // 3. Score each valid office
      const scoredOffices: OfficeScore[] = [];
      
      for (const office of validOffices) {
        const score = await this.scoreOffice(office, request, clinician);
        scoredOffices.push(score);
        log.push(`Scored office ${office.officeId}: ${score.score} points`);
        log.push(...score.log);
      }

      // 4. Sort by score and check for hard matches
      const hardMatches = scoredOffices.filter(score => 
        score.reasons.some(reason => reason.startsWith('HARD:'))
      );

      const candidates = hardMatches.length > 0 ? hardMatches : scoredOffices;
      candidates.sort((a, b) => b.score - a.score);

      if (candidates.length === 0) {
        return {
          success: false,
          error: 'No suitable offices found after scoring',
          evaluationLog: log
        };
      }

      const bestMatch = candidates[0];
      log.push(`Selected office ${bestMatch.office.officeId} with score ${bestMatch.score}`);
      log.push(`Assignment reasons: ${bestMatch.reasons.join(', ')}`);

      return {
        success: true,
        officeId: bestMatch.office.officeId,
        conflicts: bestMatch.conflicts,
        notes: bestMatch.reasons.join('; '),
        evaluationLog: [...log, ...bestMatch.log]
      };

    } catch (error) {
      log.push(`Error in office assignment: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
        evaluationLog: log
      };
    }
  }

  private filterValidOffices(
    request: SchedulingRequest,
    clinician: SheetClinician
  ): SheetOffice[] {
    const log: string[] = [];
    
    return this.offices.filter(office => {
      // Check if office is in service
      if (!office.inService) {
        log.push(`Office ${office.officeId} filtered: not in service`);
        return false;
      }

      // Check accessibility requirements
      if (request.requirements?.accessibility && !office.isAccessible) {
        log.push(`Office ${office.officeId} filtered: accessibility requirements not met`);
        return false;
      }

      // Check clinician preferences - BUT don't exclude if they're the primary clinician
      if (office.primaryClinician !== clinician.clinicianId && 
          clinician.preferredOffices.length > 0 && 
          !clinician.preferredOffices.includes(office.officeId)) {
        log.push(`Office ${office.officeId} filtered: not in clinician's preferred offices`);
        return false;
      }

      // Check special features
      if (request.requirements?.specialFeatures?.length) {
        const hasAllFeatures = request.requirements.specialFeatures.every(
          feature => office.specialFeatures.includes(feature)
        );
        if (!hasAllFeatures) {
          log.push(`Office ${office.officeId} filtered: missing required features`);
          return false;
        }
      }

      // Check session type requirements
      if (request.sessionType === 'group' && 
          !office.specialFeatures.includes('group')) {
        log.push(`Office ${office.officeId} filtered: not suitable for group sessions`);
        return false;
      }

      return true;
    });
  }

  private async scoreOffice(
    office: SheetOffice,
    request: SchedulingRequest,
    clinician: SheetClinician
  ): Promise<OfficeScore> {
    const score: OfficeScore = {
      office,
      score: 0,
      reasons: [],
      conflicts: [],
      log: [`Starting evaluation for office ${office.officeId}`]
    };

    // 1. Check existing bookings and conflicts
    const existingBookings = this.existingBookings.get(office.officeId) || [];
    const timeConflicts = this.checkTimeConflicts(request, existingBookings);
    
    if (timeConflicts.length > 0) {
      score.log.push(`Found ${timeConflicts.length} time conflicts`);
      score.conflicts = timeConflicts;
      return score;
    }

    // 2. Apply base scoring
    
    // Primary clinician office gets highest base score
    if (office.primaryClinician === clinician.clinicianId) {
      score.score += 1000;
      score.reasons.push('HARD: Primary clinician office');
      score.log.push('Added 1000 points: Primary clinician office');
    }
    
    // Alternative clinicians get good but lower score
    else if (office.alternativeClinicians?.includes(clinician.clinicianId)) {
      score.score += 500;
      score.reasons.push('Alternative clinician office');
      score.log.push('Added 500 points: Alternative clinician office');
    }
    
    // Preferred office bonus
    if (clinician.preferredOffices.includes(office.officeId)) {
      score.score += 200;
      score.reasons.push('Clinician preferred office');
      score.log.push('Added 200 points: Clinician preferred office');
    }

    // 3. Apply rules in priority order
    const sortedRules = [...this.rules]
      .filter(rule => rule.active)
      .sort((a, b) => a.priority - b.priority);

    for (const rule of sortedRules) {
      const ruleScore = this.evaluateRule(rule, office, request, clinician);
      score.score += ruleScore.score;
      if (ruleScore.score > 0) {
        score.reasons.push(ruleScore.reason);
        score.log.push(...ruleScore.log);
      }
    }

    // 4. Apply client preferences if available
    if (this.clientPreference) {
      const prefScore = this.evaluateClientPreferences(office);
      score.score += prefScore.score;
      if (prefScore.score > 0) {
        score.reasons.push(...prefScore.reasons);
        score.log.push(...prefScore.log);
      }
    }

    // 5. Apply session type specific scoring
    const sessionScore = this.evaluateSessionType(office, request.sessionType);
    score.score += sessionScore.score;
    if (sessionScore.score > 0) {
      score.reasons.push(sessionScore.reason);
      score.log.push(...sessionScore.log);
    }

    score.log.push(`Final score for ${office.officeId}: ${score.score}`);
    return score;
  }

  private evaluateRule(
    rule: AssignmentRule,
    office: SheetOffice,
    request: SchedulingRequest,
    clinician: SheetClinician
  ): RuleEvaluationResult {
    const log: string[] = [`Evaluating rule: ${rule.ruleName}`];
    
    // Check if this rule applies to this office
    if (!rule.officeIds.includes(office.officeId)) {
      return { score: 0, reason: '', log: [`Rule ${rule.ruleName} doesn't apply to office ${office.officeId}`] };
    }

    switch (rule.ruleType) {
      case 'accessibility':
        if (request.requirements?.accessibility && office.isAccessible) {
          const score = rule.overrideLevel === 'hard' ? 1000 : 200;
          return {
            score,
            reason: rule.overrideLevel === 'hard' ? `HARD: ${rule.ruleName}` : rule.ruleName,
            log: [`Added ${score} points for accessibility match`]
          };
        }
        break;

      case 'age_group':
        if (request.clientAge) {
          const condition = rule.condition;
          if (this.evaluateAgeCondition(condition, request.clientAge)) {
            const score = rule.overrideLevel === 'hard' ? 800 : 150;
            return {
              score,
              reason: rule.overrideLevel === 'hard' ? `HARD: ${rule.ruleName}` : rule.ruleName,
              log: [`Added ${score} points for age group match`]
            };
          }
        }
        break;

      case 'session_type':
        if (request.sessionType === rule.condition) {
          const score = rule.overrideLevel === 'hard' ? 600 : 100;
          return {
            score,
            reason: rule.overrideLevel === 'hard' ? `HARD: ${rule.ruleName}` : rule.ruleName,
            log: [`Added ${score} points for session type match`]
          };
        }
        break;
    }

    return { score: 0, reason: '', log: [`No points added for rule ${rule.ruleName}`] };
  }

  private evaluateClientPreferences(office: SheetOffice): {
    score: number;
    reasons: string[];
    log: string[];
  } {
    const result = {
      score: 0,
      reasons: [] as string[],
      log: ['Evaluating client preferences']
    };

    if (!this.clientPreference) {
      result.log.push('No client preferences available');
      return result;
    }

    // Check previous office assignment
    if (this.clientPreference.assignedOffice === office.officeId) {
      const roomScore = (this.clientPreference.roomConsistency || 0) * 50;
      result.score += roomScore;
      result.reasons.push('Previous office match');
      result.log.push(`Added ${roomScore} points for previous office match`);
    }

    // Safely check mobility needs
    const mobilityNeeds = this.clientPreference.mobilityNeeds || [];
    if (Array.isArray(mobilityNeeds) && mobilityNeeds.length > 0 && office.isAccessible) {
      result.score += 300;
      result.reasons.push('Meets mobility needs');
      result.log.push('Added 300 points for mobility needs match');
    }

    // Safely check sensory preferences
    const sensoryPrefs = this.clientPreference.sensoryPreferences || [];
    if (Array.isArray(sensoryPrefs) && sensoryPrefs.length > 0) {
      const matchingSensory = sensoryPrefs.filter(
        pref => office.specialFeatures.includes(pref)
      );
      if (matchingSensory.length > 0) {
        const sensoryScore = matchingSensory.length * 50;
        result.score += sensoryScore;
        result.reasons.push('Matches sensory preferences');
        result.log.push(`Added ${sensoryScore} points for sensory preference matches`);
      }
    }

    return result;
  }

  private evaluateSessionType(
    office: SheetOffice,
    sessionType: string
  ): RuleEvaluationResult {
    switch (sessionType) {
      case 'group':
        if (office.specialFeatures.includes('group')) {
          return {
            score: 200,
            reason: 'Suitable for group sessions',
            log: ['Added 200 points for group session capability']
          };
        }
        break;

      case 'family':
        if (office.size === 'large') {
          return {
            score: 150,
            reason: 'Suitable size for family sessions',
            log: ['Added 150 points for family session size']
          };
        }
        break;
    }

    return { score: 0, reason: '', log: ['No specific session type points added'] };
  }

  private evaluateAgeCondition(condition: string, age: number): boolean {
    // Handle different age condition formats
    if (condition.includes('&&')) {
      const [minStr, maxStr] = condition.split('&&');
      const minAge = parseInt(minStr.split('>')[1].trim());
      const maxAge = parseInt(maxStr.split('<=')[1].trim());
      return age > minAge && age <= maxAge;
    }
    
    if (condition.includes('<=')) {
      const maxAge = parseInt(condition.split('<=')[1].trim());
      return age <= maxAge;
    }
    
    if (condition.includes('>=')) {
      const minAge = parseInt(condition.split('>=')[1].trim());
      return age >= minAge;
    }

    return false;
  }

  private checkTimeConflicts(
    request: SchedulingRequest,
    existingBookings: SchedulingRequest[]
  ): SchedulingConflict[] {
    const conflicts: SchedulingConflict[] = [];
    const requestStart = new Date(request.dateTime);
    const requestEnd = new Date(requestStart.getTime() + (request.duration * 60 * 1000));

    existingBookings.forEach(booking => {
      const bookingStart = new Date(booking.dateTime);
      const bookingEnd = new Date(bookingStart.getTime() + (booking.duration * 60 * 1000));

      if (requestStart < bookingEnd && requestEnd > bookingStart) {
        conflicts.push({
          officeId: request.clinicianId, // Using clinicianId for tracking
          existingBooking: booking,
          resolution: {
            type: 'cannot-relocate',
            reason: 'Time slot overlap with existing booking'
          }
        });
      }
    });

    return conflicts;
  }
}