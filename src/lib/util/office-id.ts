// src/lib/util/office-id.ts

export type StandardOfficeId = `${Uppercase<string>}-${Lowercase<string>}`;

/**
 * Standardizes an office ID to the correct format
 * @param id The input office ID string
 * @returns A properly formatted StandardOfficeId
 */
export function standardizeOfficeId(id: string | undefined): StandardOfficeId {
  if (!id) return 'A-a' as StandardOfficeId;
  
  // Clean the input
  const cleaned = id.trim();
  
  // Check if already in correct format
  const match = cleaned.match(/^([A-Z])-([a-z])$/);
  if (match) return cleaned as StandardOfficeId;
  
  // Try to extract floor and unit
  const alphaOnly = cleaned.replace(/[^A-Za-z]/g, '');
  if (alphaOnly.length >= 2) {
    const floor = alphaOnly[0].toUpperCase();
    const unit = alphaOnly[1].toLowerCase();
    return `${floor}-${unit}` as StandardOfficeId;
  }
  
  // Return default if we can't standardize
  return 'A-a' as StandardOfficeId;
}

/**
 * Validates if a string is a proper StandardOfficeId
 * @param id The ID to validate
 * @returns boolean indicating if valid
 */
export function isValidOfficeId(id: string): boolean {
  return /^[A-Z]-[a-z]$/.test(id);
}

/**
 * Get components of a StandardOfficeId
 * @param id The StandardOfficeId to parse
 * @returns Object containing floor and unit
 */
export function parseOfficeId(id: StandardOfficeId): { floor: string; unit: string } {
  const [floor, unit] = id.split('-');
  return { floor, unit };
}

/**
 * Creates a display version of the office ID
 * @param id The StandardOfficeId to format
 * @returns Formatted string for display
 */
export function formatOfficeId(id: StandardOfficeId): string {
  const { floor, unit } = parseOfficeId(id);
  return `Floor ${floor}, Unit ${unit.toUpperCase()}`;
}