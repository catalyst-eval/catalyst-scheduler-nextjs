// src/lib/google/sheets.ts

import { google } from 'googleapis';
import { JWT } from 'google-auth-library';
import type { 
  SheetOffice, 
  SheetClinician, 
  AssignmentRule, 
  ClientPreference,
  ScheduleConfig,
  IntegrationSetting,
  AuditLogEntry 
} from '@/types/sheets';

import type { AppointmentRecord } from '../../types/scheduling';
import { SheetsCacheService } from './sheets-cache';

export enum AuditEventType {
  // Configuration Events
  CONFIG_UPDATED = 'CONFIG_UPDATED',
  RULE_CREATED = 'RULE_CREATED',
  RULE_UPDATED = 'RULE_UPDATED',
  
  // Client Events
  CLIENT_PREFERENCES_UPDATED = 'CLIENT_PREFERENCES_UPDATED',
  CLIENT_OFFICE_ASSIGNED = 'CLIENT_OFFICE_ASSIGNED',
  
  // Appointment Events
  APPOINTMENT_CREATED = 'APPOINTMENT_CREATED',
  APPOINTMENT_UPDATED = 'APPOINTMENT_UPDATED',
  APPOINTMENT_CANCELLED = 'APPOINTMENT_CANCELLED',
  
  // System Events
  SYSTEM_ERROR = 'SYSTEM_ERROR',
  WEBHOOK_RECEIVED = 'WEBHOOK_RECEIVED',
  INTEGRATION_UPDATED = 'INTEGRATION_UPDATED',
  
  // Daily Assignment Events
  DAILY_ASSIGNMENTS_UPDATED = 'DAILY_ASSIGNMENTS_UPDATED',
  
  // Error Events
  CRITICAL_ERROR = 'CRITICAL_ERROR'
}

export class GoogleSheetsService {
  private sheets;
  private spreadsheetId: string;
  private cache: SheetsCacheService;

  async getOffices(): Promise<SheetOffice[]> {
    const values = await this.readSheet('Offices Configuration!A2:M');
    
    return values?.map(row => ({
      officeId: row[0],
      name: row[1],
      unit: row[2],
      inService: row[3] === 'TRUE',
      floor: row[4] as 'upstairs' | 'downstairs',
      isAccessible: row[5] === 'TRUE',
      size: row[6] as 'small' | 'medium' | 'large',
      ageGroups: row[7]?.split(',').map((s: string) => s.trim()) || [],
      specialFeatures: row[8]?.split(',').map((s: string) => s.trim()) || [],
      primaryClinician: row[9] || undefined,
      alternativeClinicians: row[10]?.split(',').map((s: string) => s.trim()) || [],
      isFlexSpace: row[11] === 'TRUE',
      notes: row[12]
    })) ?? [];
  }

  constructor(credentials: any, spreadsheetId: string) {
    const client = new JWT({
      email: credentials.client_email,
      key: credentials.private_key,
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });

    this.sheets = google.sheets({ version: 'v4', auth: client });
    this.spreadsheetId = spreadsheetId;
    this.cache = new SheetsCacheService();
  }

  // Helper method to read a specific sheet tab
  private async readSheet(range: string) {
    const cacheKey = `sheet:${range}`;
    
    try {
      return await this.cache.getOrFetch(
        cacheKey,
        async () => {
          console.log(`Reading sheet range: ${range}`);
          const response = await this.sheets.spreadsheets.values.get({
            spreadsheetId: this.spreadsheetId,
            range,
          });
          return response.data.values;
        },
        60000 // 1 minute cache TTL
      );
    } catch (error) {
      console.error(`Error reading sheet ${range}:`, error);
      await this.addAuditLog({
        timestamp: new Date().toISOString(),
        eventType: AuditEventType.SYSTEM_ERROR,
        description: `Failed to read sheet ${range}`,
        user: 'SYSTEM',
        systemNotes: JSON.stringify(error)
      });
      throw new Error(`Failed to read sheet ${range}`);
    }
  }

  // Helper method to append rows to a sheet
  private async appendRows(range: string, values: any[][]) {
    try {
      await this.sheets.spreadsheets.values.append({
        spreadsheetId: this.spreadsheetId,
        range,
        valueInputOption: 'RAW',
        requestBody: {
          values
        }
      });
    } catch (error) {
      console.error(`Error appending to sheet ${range}:`, error);
      throw error;
    }
  }

  // Clinicians Configuration
  async getClinicians(): Promise<SheetClinician[]> {
    const values = await this.readSheet('Clinicians Configuration!A2:M');
    
    return values?.map(row => ({
      clinicianId: row[0],
      name: row[1],
      email: row[2],
      role: row[3] as 'owner' | 'admin' | 'clinician' | 'intern',
      ageRangeMin: Number(row[4]),
      ageRangeMax: Number(row[5]),
      specialties: row[6]?.split(',').map((s: string) => s.trim()) || [],
      caseloadLimit: Number(row[7]),
      currentCaseload: Number(row[8]),
      preferredOffices: row[9]?.split(',').map((s: string) => s.trim()) || [],
      allowsRelationship: row[10] === 'TRUE',
      certifications: row[11]?.split(',').map((s: string) => s.trim()) || [],
      intakeQPractitionerId: row[12]
    })) ?? [];
  }

  // Assignment Rules
  async getAssignmentRules(): Promise<AssignmentRule[]> {
    const values = await this.readSheet('Assignment Rules!A2:H');
    
    return values?.map(row => ({
      priority: Number(row[0]),
      ruleName: row[1],
      ruleType: row[2],
      condition: row[3],
      officeIds: row[4]?.split(',').map((s: string) => s.trim()) || [],
      overrideLevel: row[5] as 'hard' | 'soft' | 'none',
      active: row[6] === 'TRUE',
      notes: row[7]
    })) ?? [];
  }

  // Update the getClientPreferences method in GoogleSheetsService
async getClientPreferences(): Promise<ClientPreference[]> {
  const values = await this.readSheet('Client Preferences!A2:L');
  
  return values?.map(row => ({
    clientId: row[0],
    name: row[1],
    email: row[2],
    mobilityNeeds: JSON.parse(row[3] || '[]'),
    sensoryPreferences: JSON.parse(row[4] || '[]'),
    physicalNeeds: JSON.parse(row[5] || '[]'),
    roomConsistency: Number(row[6]),
    supportNeeds: JSON.parse(row[7] || '[]'),
    specialFeatures: [], // Added this required field with default empty array
    additionalNotes: row[8],
    lastUpdated: row[9],
    preferredClinician: row[10],
    assignedOffice: row[11]
  })) ?? [];
}

  // Schedule Configuration
  async getScheduleConfig(): Promise<ScheduleConfig[]> {
    const values = await this.readSheet('Schedule Configuration!A2:E');
    
    return values?.map(row => ({
      settingName: row[0],
      value: row[1],
      description: row[2],
      lastUpdated: row[3],
      updatedBy: row[4]
    })) ?? [];
  }

  // Integration Settings
  async getIntegrationSettings(): Promise<IntegrationSetting[]> {
    const values = await this.readSheet('Integration Settings!A2:E');
    
    return values?.map(row => ({
      serviceName: row[0],
      settingType: row[1],
      value: row[2],
      description: row[3],
      lastUpdated: row[4]
    })) ?? [];
  }

  // Enhanced Audit Logging
  async addAuditLog(entry: AuditLogEntry): Promise<void> {
    try {
      const rowData = [
        entry.timestamp,
        entry.eventType,
        entry.description,
        entry.user,
        entry.previousValue || '',
        entry.newValue || '',
        entry.systemNotes || ''
      ];

      await this.appendRows('Audit Log!A:G', [rowData]);
      console.log('Audit log entry added:', entry);
    } catch (error) {
      console.error('Error adding audit log:', error);
      // If audit log fails, we need to handle it gracefully
      console.error('Failed audit log entry:', entry);
    }
  }

  // Update methods
  async updateClientPreference(preference: ClientPreference): Promise<void> {
    try {
      const values = await this.readSheet('Client Preferences!A:A');
      const clientRow = values?.findIndex(row => row[0] === preference.clientId);
      
      const rowData = [
        preference.clientId,
        preference.name,
        preference.email,
        JSON.stringify(preference.mobilityNeeds),
        JSON.stringify(preference.sensoryPreferences),
        JSON.stringify(preference.physicalNeeds),
        preference.roomConsistency.toString(),
        JSON.stringify(preference.supportNeeds),
        preference.additionalNotes || '',
        new Date().toISOString(),
        preference.preferredClinician || '',
        preference.assignedOffice || ''
      ];

      if (clientRow && clientRow > 0) {
        // Update existing row
        await this.sheets.spreadsheets.values.update({
          spreadsheetId: this.spreadsheetId,
          range: `Client Preferences!A${clientRow + 1}`,
          valueInputOption: 'RAW',
          requestBody: {
            values: [rowData]
          }
        });
      } else {
        // Append new row
        await this.appendRows('Client Preferences!A:L', [rowData]);
      }

      await this.addAuditLog({
        timestamp: new Date().toISOString(),
        eventType: AuditEventType.CLIENT_PREFERENCES_UPDATED,
        description: `Updated preferences for client ${preference.clientId}`,
        user: 'SYSTEM',
        systemNotes: JSON.stringify(preference)
      });

    } catch (error) {
      console.error('Error updating client preference:', error);
      throw error;
    }
  }
  /**
   * Force refresh cache for a specific range
   */
  async refreshCache(range: string): Promise<void> {
    this.cache.invalidate(`sheet:${range}`);
  }

  /**
   * Clear all cached data
   */
  clearCache(): void {
    this.cache.clearAll();
  }
}