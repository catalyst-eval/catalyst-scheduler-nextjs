// src/lib/intakeq/accessibility-form.ts

import type { ClientPreference } from '@/types/sheets';

interface AccessibilityFormResponses {
  mobilityDevices?: string[];
  mobilityOther?: string;
  sensoryPreferences?: string[];
  sensoryOther?: string;
  physicalNeeds?: string[];
  physicalOther?: string;
  roomConsistency?: string;
  supportNeeds?: string[];
  supportOther?: string;
  additionalNotes?: string;
}

/**
 * Process mobility needs from form responses
 */
function processMobilityNeeds(responses: AccessibilityFormResponses): string[] {
  const needs: string[] = [];
  
  if (responses.mobilityDevices) {
    needs.push(...responses.mobilityDevices);
  }
  
  if (responses.mobilityOther) {
    needs.push(responses.mobilityOther);
  }
  
  return needs.filter(Boolean);
}

/**
 * Process sensory preferences from form responses
 */
function processSensoryPreferences(responses: AccessibilityFormResponses): string[] {
  const preferences: string[] = [];
  
  if (responses.sensoryPreferences) {
    preferences.push(...responses.sensoryPreferences);
  }
  
  if (responses.sensoryOther) {
    preferences.push(responses.sensoryOther);
  }
  
  return preferences.filter(Boolean);
}

/**
 * Process physical needs from form responses
 */
function processPhysicalNeeds(responses: AccessibilityFormResponses): string[] {
  const needs: string[] = [];
  
  if (responses.physicalNeeds) {
    needs.push(...responses.physicalNeeds);
  }
  
  if (responses.physicalOther) {
    needs.push(responses.physicalOther);
  }
  
  return needs.filter(Boolean);
}

/**
 * Map room consistency preference to numeric value
 */
function mapRoomConsistency(response: string | undefined): number {
  if (!response) return 3; // Default to neutral if no response

  switch (response) {
    case '1 - Strong preference for consistency':
      return 5;
    case '2 - High preference for consistency':
      return 4;
    case '3 - Neutral about room changes':
      return 3;
    case '4 - Somewhat comfortable with room changes when needed':
      return 2;
    case '5 - Very comfortable with room changes when needed':
      return 1;
    default:
      return 3; // Default to neutral for unknown values
  }
}

/**
 * Process support needs from form responses
 */
function processSupportNeeds(responses: AccessibilityFormResponses): string[] {
  const needs: string[] = [];
  
  if (responses.supportNeeds) {
    needs.push(...responses.supportNeeds);
  }
  
  if (responses.supportOther) {
    needs.push(responses.supportOther);
  }
  
  return needs.filter(Boolean);
}

/**
 * Process accessibility form responses
 */
export function processAccessibilityForm(formResponses: Record<string, any>): ClientPreference {
  const responses: AccessibilityFormResponses = {
    mobilityDevices: formResponses['Do you use any mobility devices or require ground floor access for any reason?'],
    mobilityOther: formResponses['Access needs related to mobility/disability (Please specify)'],
    sensoryPreferences: formResponses['Do you experience sensory sensitivities that would be valuable to accommodate?'],
    sensoryOther: formResponses['Other (Please specify):'],
    physicalNeeds: formResponses['Do you experience challenges with physical environment that would be valuable to accommodate?'],
    physicalOther: formResponses['Other (Please specify)'],
    roomConsistency: formResponses['Please indicate your comfort level with this possibility:'],
    supportNeeds: formResponses['Do you have support needs that involve any of the following?'],
    supportOther: formResponses['Other (Please specify)'],
    additionalNotes: formResponses['Is there anything else we should know about your space or accessibility needs?']
  };

  // Update the return object in processAccessibilityForm function
  return {
    clientId: formResponses.clientId?.toString() || '',
    name: formResponses.clientName || '',
    email: formResponses.clientEmail || '',
    mobilityNeeds: processMobilityNeeds(responses),
    sensoryPreferences: processSensoryPreferences(responses),
    physicalNeeds: processPhysicalNeeds(responses),
    roomConsistency: mapRoomConsistency(responses.roomConsistency),
    supportNeeds: processSupportNeeds(responses),
    specialFeatures: [...processSensoryPreferences(responses), ...processPhysicalNeeds(responses)], // Derive from existing preferences
    additionalNotes: responses.additionalNotes || '',
    lastUpdated: new Date().toISOString(),
    preferredClinician: formResponses.preferredClinician || '',
    assignedOffice: formResponses.assignedOffice || ''
  };
}