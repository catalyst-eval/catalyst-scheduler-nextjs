// src/lib/types.ts

export interface SheetOffice {
    officeId: string;
    name: string;
    unit: string;
    inService: boolean;     // New field
    floor: 'upstairs' | 'downstairs';
    isAccessible: boolean;
    size: 'small' | 'medium' | 'large';
    ageGroups: string[];
    specialFeatures: string[];
    primaryClinician?: string;
    alternativeClinicians?: string[];
    isFlexSpace: boolean;
    notes?: string;
  }