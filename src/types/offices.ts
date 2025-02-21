// src/types/offices.ts

/**
 * Core office ID format that allows numbers for B/C floors
 */
export type StandardOfficeId = `${Uppercase<string>}-${string}`;

export interface OfficeLocation {
  floor: string;
  unit: string;
}

export type OfficeFloor = 'A' | 'B' | 'C';
export type UnitFormat = 'letter' | 'number';