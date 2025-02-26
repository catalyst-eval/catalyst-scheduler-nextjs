"use strict";
// src/lib/google/sheets.ts
Object.defineProperty(exports, "__esModule", { value: true });
exports.GoogleSheetsService = exports.AuditEventType = void 0;
const googleapis_1 = require("googleapis");
const google_auth_library_1 = require("google-auth-library");
const scheduling_1 = require("../../types/scheduling");
const sheets_cache_1 = require("./sheets-cache");
var AuditEventType;
(function (AuditEventType) {
    AuditEventType["CONFIG_UPDATED"] = "CONFIG_UPDATED";
    AuditEventType["RULE_CREATED"] = "RULE_CREATED";
    AuditEventType["RULE_UPDATED"] = "RULE_UPDATED";
    AuditEventType["CLIENT_PREFERENCES_UPDATED"] = "CLIENT_PREFERENCES_UPDATED";
    AuditEventType["CLIENT_OFFICE_ASSIGNED"] = "CLIENT_OFFICE_ASSIGNED";
    AuditEventType["APPOINTMENT_CREATED"] = "APPOINTMENT_CREATED";
    AuditEventType["APPOINTMENT_UPDATED"] = "APPOINTMENT_UPDATED";
    AuditEventType["APPOINTMENT_CANCELLED"] = "APPOINTMENT_CANCELLED";
    AuditEventType["APPOINTMENT_DELETED"] = "APPOINTMENT_DELETED";
    AuditEventType["SYSTEM_ERROR"] = "SYSTEM_ERROR";
    AuditEventType["WEBHOOK_RECEIVED"] = "WEBHOOK_RECEIVED";
    AuditEventType["INTEGRATION_UPDATED"] = "INTEGRATION_UPDATED";
    AuditEventType["DAILY_ASSIGNMENTS_UPDATED"] = "DAILY_ASSIGNMENTS_UPDATED";
    AuditEventType["CRITICAL_ERROR"] = "CRITICAL_ERROR";
})(AuditEventType || (exports.AuditEventType = AuditEventType = {}));
class GoogleSheetsService {
    constructor() {
        console.log('Google Sheets Service initializing...');
        if (!process.env.GOOGLE_SHEETS_PRIVATE_KEY || !process.env.GOOGLE_SHEETS_CLIENT_EMAIL) {
            throw new Error('Missing required Google Sheets credentials');
        }
        // Handle different formats of private key
        let privateKey = process.env.GOOGLE_SHEETS_PRIVATE_KEY;
        // Replace literal \n with actual newlines
        privateKey = privateKey.replace(/\\n/g, '\n');
        // If key is enclosed in quotes, remove them
        if (privateKey.startsWith('"') && privateKey.endsWith('"')) {
            privateKey = privateKey.slice(1, -1);
        }
        console.log('Private key length:', privateKey.length);
        console.log('Private key starts with:', privateKey.substring(0, 20) + '...');
        try {
            const client = new google_auth_library_1.JWT({
                email: process.env.GOOGLE_SHEETS_CLIENT_EMAIL,
                key: privateKey,
                scopes: ['https://www.googleapis.com/auth/spreadsheets']
            });
            this.sheets = googleapis_1.google.sheets({ version: 'v4', auth: client });
            this.spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID || '';
            this.cache = new sheets_cache_1.SheetsCacheService();
            console.log('GoogleSheetsService initialized successfully');
        }
        catch (error) {
            console.error('Error initializing Google Sheets client:', error);
            throw error;
        }
    }
    async readSheet(range) {
        const cacheKey = `sheet:${range}`;
        try {
            return await this.cache.getOrFetch(cacheKey, async () => {
                console.log(`Reading sheet range: ${range}`);
                try {
                    const response = await this.sheets.spreadsheets.values.get({
                        spreadsheetId: this.spreadsheetId,
                        range,
                    });
                    console.log(`Successfully read sheet range: ${range}`);
                    return response.data.values;
                }
                catch (error) {
                    console.error(`Error in Google API call for range ${range}:`, error);
                    throw error;
                }
            }, 60000 // 1 minute cache TTL
            );
        }
        catch (error) {
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
    async appendRows(range, values) {
        try {
            await this.sheets.spreadsheets.values.append({
                spreadsheetId: this.spreadsheetId,
                range,
                valueInputOption: 'RAW',
                requestBody: {
                    values
                }
            });
        }
        catch (error) {
            console.error(`Error appending to sheet ${range}:`, error);
            throw error;
        }
    }
    // Make all public methods public by removing the 'private' keyword
    async getOffices() {
        const values = await this.readSheet('Offices Configuration!A2:M');
        return values?.map((row) => ({
            officeId: row[0],
            name: row[1],
            unit: row[2],
            inService: row[3] === 'TRUE',
            floor: row[4],
            isAccessible: row[5] === 'TRUE',
            size: row[6],
            ageGroups: row[7]?.split(',').map((s) => s.trim()) || [],
            specialFeatures: row[8]?.split(',').map((s) => s.trim()) || [],
            primaryClinician: row[9] || undefined,
            alternativeClinicians: row[10]?.split(',').map((s) => s.trim()) || [],
            isFlexSpace: row[11] === 'TRUE',
            notes: row[12]
        })) ?? [];
    }
    async getClinicians() {
        const values = await this.readSheet('Clinicians Configuration!A2:M');
        return values?.map((row) => ({
            clinicianId: row[0],
            name: row[1],
            email: row[2],
            role: row[3],
            ageRangeMin: Number(row[4]),
            ageRangeMax: Number(row[5]),
            specialties: row[6]?.split(',').map((s) => s.trim()) || [],
            caseloadLimit: Number(row[7]),
            currentCaseload: Number(row[8]),
            preferredOffices: row[9]?.split(',').map((s) => s.trim()) || [],
            allowsRelationship: row[10] === 'TRUE',
            certifications: row[11]?.split(',').map((s) => s.trim()) || [],
            intakeQPractitionerId: row[12]
        })) ?? [];
    }
    async getAssignmentRules() {
        const values = await this.readSheet('Assignment Rules!A2:H');
        return values?.map((row) => ({
            priority: Number(row[0]),
            ruleName: row[1],
            ruleType: row[2],
            condition: row[3],
            officeIds: row[4]?.split(',').map((s) => s.trim()) || [],
            overrideLevel: row[5],
            active: row[6] === 'TRUE',
            notes: row[7]
        })) ?? [];
    }
    async getClientPreferences() {
        const values = await this.readSheet('Client Preferences!A2:L');
        return values?.map((row) => ({
            clientId: row[0],
            name: row[1],
            email: row[2],
            mobilityNeeds: JSON.parse(row[3] || '[]'),
            sensoryPreferences: JSON.parse(row[4] || '[]'),
            physicalNeeds: JSON.parse(row[5] || '[]'),
            roomConsistency: Number(row[6]),
            supportNeeds: JSON.parse(row[7] || '[]'),
            specialFeatures: [], // Added required field with default empty array
            additionalNotes: row[8],
            lastUpdated: row[9],
            preferredClinician: row[10],
            assignedOffice: row[11]
        })) ?? [];
    }
    async getScheduleConfig() {
        const values = await this.readSheet('Schedule Configuration!A2:E');
        return values?.map((row) => ({
            settingName: row[0],
            value: row[1],
            description: row[2],
            lastUpdated: row[3],
            updatedBy: row[4]
        })) ?? [];
    }
    async getIntegrationSettings() {
        const values = await this.readSheet('Integration Settings!A2:E');
        return values?.map((row) => ({
            serviceName: row[0],
            settingType: row[1],
            value: row[2],
            description: row[3],
            lastUpdated: row[4]
        })) ?? [];
    }
    async addAuditLog(entry) {
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
        }
        catch (error) {
            console.error('Error adding audit log:', error);
            console.error('Failed audit log entry:', entry);
        }
    }
    async getRecentAuditLogs(limit = 5) {
        try {
            const values = await this.readSheet('Audit Log!A2:G');
            if (!values)
                return [];
            return values
                .map((row) => ({
                timestamp: row[0],
                eventType: row[1],
                description: row[2],
                user: row[3],
                previousValue: row[4] || undefined,
                newValue: row[5] || undefined,
                systemNotes: row[6] || undefined
            }))
                .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
                .slice(0, limit);
        }
        catch (error) {
            console.error('Error reading audit logs:', error);
            return [];
        }
    }
    async getOfficeAppointments(officeId, date) {
        const startOfDay = new Date(date);
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(date);
        endOfDay.setHours(23, 59, 59, 999);
        const appointments = await this.getAppointments(startOfDay.toISOString(), endOfDay.toISOString());
        if (officeId === 'all') {
            return appointments;
        }
        const standardizedTargetId = (0, scheduling_1.standardizeOfficeId)(officeId);
        return appointments.filter(appt => (0, scheduling_1.standardizeOfficeId)(appt.officeId) === standardizedTargetId);
    }
    async addAppointment(appt) {
        try {
            const standardizedOfficeId = (0, scheduling_1.standardizeOfficeId)(appt.officeId);
            const standardizedSuggestedId = appt.suggestedOfficeId ?
                (0, scheduling_1.standardizeOfficeId)(appt.suggestedOfficeId) : standardizedOfficeId;
            const rowData = [
                appt.appointmentId,
                appt.clientId,
                appt.clientName,
                appt.clinicianId,
                appt.clinicianName,
                standardizedOfficeId,
                appt.sessionType,
                appt.startTime,
                appt.endTime,
                appt.status,
                appt.lastUpdated,
                appt.source,
                JSON.stringify(appt.requirements || {}),
                appt.notes || '',
                standardizedSuggestedId
            ];
            await this.appendRows('Appointments!A:O', [rowData]);
            await this.addAuditLog({
                timestamp: new Date().toISOString(),
                eventType: AuditEventType.APPOINTMENT_CREATED,
                description: `Added appointment ${appt.appointmentId}`,
                user: 'SYSTEM',
                systemNotes: JSON.stringify({
                    ...appt,
                    officeId: standardizedOfficeId,
                    suggestedOfficeId: standardizedSuggestedId
                })
            });
            await this.refreshCache('Appointments!A2:O');
        }
        catch (error) {
            console.error('Error adding appointment:', error);
            throw new Error('Failed to add appointment');
        }
    }
    async getAppointments(startDate, endDate) {
        try {
            const values = await this.readSheet('Appointments!A2:O');
            if (!values || !Array.isArray(values)) {
                console.log('No appointments found in sheet');
                return [];
            }
            console.log('Processing appointments from sheet:', {
                rowCount: values.length,
                dateRange: { startDate, endDate }
            });
            const initialAppointments = values
                .map((row) => {
                try {
                    const assignedOffice = row[5] || 'A-a';
                    const suggestedOffice = row[14] || assignedOffice;
                    const standardizedOfficeId = (0, scheduling_1.standardizeOfficeId)(assignedOffice);
                    const standardizedSuggestedId = (0, scheduling_1.standardizeOfficeId)(suggestedOffice);
                    let requirements = { accessibility: false, specialFeatures: [] };
                    try {
                        const requirementsStr = row[12]?.toString().trim();
                        if (requirementsStr) {
                            const cleanJson = requirementsStr
                                .replace(/[\u0000-\u0019]+/g, '')
                                .replace(/\s+/g, ' ')
                                .trim();
                            requirements = JSON.parse(cleanJson);
                        }
                    }
                    catch (err) {
                        console.error('Error parsing requirements JSON:', err, { value: row[12] });
                    }
                    return {
                        appointmentId: row[0] || '',
                        clientId: row[1] || '',
                        clientName: row[2] || row[1] || '',
                        clinicianId: row[3] || '',
                        clinicianName: row[4] || row[3] || '',
                        officeId: standardizedOfficeId,
                        suggestedOfficeId: standardizedSuggestedId,
                        sessionType: (row[6] || 'in-person'),
                        startTime: row[7] || '',
                        endTime: row[8] || '',
                        status: (row[9] || 'scheduled'),
                        lastUpdated: row[10] || new Date().toISOString(),
                        source: (row[11] || 'manual'),
                        requirements,
                        notes: row[13] || ''
                    };
                }
                catch (error) {
                    console.error('Error mapping appointment row:', error, { row });
                    return null;
                }
            })
                .filter((appt) => appt !== null);
            const mappedAppointments = initialAppointments.filter(appt => {
                try {
                    const apptDate = new Date(appt.startTime).toISOString().split('T')[0];
                    const targetDate = new Date(startDate).toISOString().split('T')[0];
                    console.log('Filtering appointment:', {
                        id: appt.appointmentId,
                        date: apptDate,
                        target: targetDate,
                        match: apptDate === targetDate,
                        startTime: appt.startTime
                    });
                    return apptDate === targetDate;
                }
                catch (error) {
                    console.error('Error filtering appointment:', error, { appt });
                    return false;
                }
            });
            console.log('Appointment processing complete:', {
                totalFound: mappedAppointments.length,
                dateRange: { startDate, endDate }
            });
            return mappedAppointments;
        }
        catch (error) {
            console.error('Error reading appointments:', error);
            throw new Error('Failed to read appointments');
        }
    }
    async updateAppointment(appointment) {
        try {
            const values = await this.readSheet('Appointments!A:A');
            const appointmentRow = values?.findIndex((row) => row[0] === appointment.appointmentId);
            if (!values || !appointmentRow || appointmentRow < 0) {
                throw new Error(`Appointment ${appointment.appointmentId} not found`);
            }
            const rowData = [
                appointment.appointmentId,
                appointment.clientId,
                appointment.clinicianId,
                appointment.officeId,
                appointment.sessionType,
                appointment.startTime,
                appointment.endTime,
                appointment.status,
                appointment.lastUpdated,
                appointment.source,
                JSON.stringify(appointment.requirements || {}),
                appointment.notes || ''
            ];
            await this.sheets.spreadsheets.values.update({
                spreadsheetId: this.spreadsheetId,
                range: `Appointments!A${appointmentRow + 1}:L${appointmentRow + 1}`,
                valueInputOption: 'RAW',
                requestBody: {
                    values: [rowData]
                }
            });
            await this.addAuditLog({
                timestamp: new Date().toISOString(),
                eventType: AuditEventType.APPOINTMENT_UPDATED,
                description: `Updated appointment ${appointment.appointmentId}`,
                user: 'SYSTEM',
                previousValue: JSON.stringify(values[appointmentRow]),
                newValue: JSON.stringify(rowData)
            });
            await this.refreshCache('Appointments!A2:N');
        }
        catch (error) {
            console.error('Error updating appointment:', error);
            throw new Error('Failed to update appointment');
        }
    }
    async getAppointment(appointmentId) {
        try {
            const values = await this.readSheet('Appointments!A2:N');
            if (!values)
                return null;
            const appointmentRow = values.find((row) => row[0] === appointmentId);
            if (!appointmentRow)
                return null;
            return {
                appointmentId: appointmentRow[0],
                clientId: appointmentRow[1],
                clientName: appointmentRow[2],
                clinicianId: appointmentRow[3],
                clinicianName: appointmentRow[4],
                officeId: appointmentRow[5],
                sessionType: appointmentRow[6],
                startTime: appointmentRow[7],
                endTime: appointmentRow[8],
                status: appointmentRow[9],
                lastUpdated: appointmentRow[10],
                source: appointmentRow[11],
                requirements: JSON.parse(appointmentRow[12] || '{}'),
                notes: appointmentRow[13]
            };
        }
        catch (error) {
            console.error('Error getting appointment:', error);
            return null;
        }
    }
    async deleteAppointment(appointmentId) {
        try {
            const values = await this.readSheet('Appointments!A:A');
            const appointmentRow = values?.findIndex((row) => row[0] === appointmentId);
            if (!values || !appointmentRow || appointmentRow < 0) {
                throw new Error(`Appointment ${appointmentId} not found`);
            }
            await this.sheets.spreadsheets.values.clear({
                spreadsheetId: this.spreadsheetId,
                range: `Appointments!A${appointmentRow + 1}:L${appointmentRow + 1}`
            });
            await this.refreshCache('Appointments!A2:N');
        }
        catch (error) {
            console.error('Error deleting appointment:', error);
            throw new Error('Failed to delete appointment');
        }
    }
    async updateClientPreference(preference) {
        try {
            const values = await this.readSheet('Client Preferences!A:A');
            const clientRow = values?.findIndex((row) => row[0] === preference.clientId);
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
                await this.sheets.spreadsheets.values.update({
                    spreadsheetId: this.spreadsheetId,
                    range: `Client Preferences!A${clientRow + 1}`,
                    valueInputOption: 'RAW',
                    requestBody: {
                        values: [rowData]
                    }
                });
            }
            else {
                await this.appendRows('Client Preferences!A:L', [rowData]);
            }
            await this.addAuditLog({
                timestamp: new Date().toISOString(),
                eventType: AuditEventType.CLIENT_PREFERENCES_UPDATED,
                description: `Updated preferences for client ${preference.clientId}`,
                user: 'SYSTEM',
                systemNotes: JSON.stringify(preference)
            });
            await this.refreshCache('Client Preferences!A2:L');
        }
        catch (error) {
            console.error('Error updating client preference:', error);
            throw error;
        }
    }
    extractMobilityNeeds(responses) {
        const needs = [];
        const mobilityField = responses['Do you use any mobility devices?'] || [];
        if (Array.isArray(mobilityField)) {
            if (mobilityField.includes('Wheelchair'))
                needs.push('wheelchair_access');
            if (mobilityField.includes('Crutches'))
                needs.push('mobility_aid_crutches');
            if (mobilityField.includes('Walking boot'))
                needs.push('mobility_aid_boot');
        }
        const otherMobility = responses['Access needs related to mobility/disability (Please specify)'];
        if (otherMobility)
            needs.push(otherMobility);
        return needs;
    }
    extractSensoryPreferences(responses) {
        const preferences = [];
        const sensoryField = responses['Do you experience sensory sensitivities?'] || [];
        if (Array.isArray(sensoryField)) {
            if (sensoryField.includes('Light sensitivity'))
                preferences.push('light_sensitive');
            if (sensoryField.includes('Preference for only natural light'))
                preferences.push('natural_light');
            if (sensoryField.includes('Auditory sensitivity'))
                preferences.push('sound_sensitive');
        }
        const otherSensory = responses['Other (Please specify):'];
        if (otherSensory)
            preferences.push(otherSensory);
        return preferences;
    }
    extractPhysicalNeeds(responses) {
        const needs = [];
        const physicalField = responses['Do you experience challenges with physical environment?'] || [];
        if (Array.isArray(physicalField)) {
            if (physicalField.includes('Seating support'))
                needs.push('seating_support');
            if (physicalField.includes('Difficulty with stairs'))
                needs.push('no_stairs');
            if (physicalField.includes('Need to see the door'))
                needs.push('door_visible');
        }
        return needs;
    }
    extractRoomConsistency(responses) {
        const value = responses['Please indicate your comfort level with this possibility:'];
        const consistencyMap = {
            '1 - Strong preference for consistency': 5,
            '2 - High preference for consistency': 4,
            '3 - Neutral about room changes': 3,
            '4 - Somewhat comfortable with room changes when needed': 2,
            '5 - Very comfortable with room changes when needed': 1
        };
        return consistencyMap[value] || 3;
    }
    extractSupportNeeds(responses) {
        const needs = [];
        const supportField = responses['Do you have support needs that involve any of the following?'] || [];
        if (Array.isArray(supportField)) {
            if (supportField.includes('Space for a service animal'))
                needs.push('service_animal');
            if (supportField.includes('A support person present'))
                needs.push('support_person');
            if (supportField.includes('The use of communication aids'))
                needs.push('communication_aids');
        }
        return needs;
    }
    async processAccessibilityForm(formData) {
        try {
            const preference = {
                clientId: formData.clientId,
                name: formData.clientName,
                email: formData.clientEmail,
                mobilityNeeds: this.extractMobilityNeeds(formData.formResponses),
                sensoryPreferences: this.extractSensoryPreferences(formData.formResponses),
                physicalNeeds: this.extractPhysicalNeeds(formData.formResponses),
                roomConsistency: this.extractRoomConsistency(formData.formResponses),
                supportNeeds: this.extractSupportNeeds(formData.formResponses),
                specialFeatures: [], // Will be derived from other preferences
                additionalNotes: formData.formResponses['Is there anything else we should know about your space or accessibility needs?'] || '',
                lastUpdated: new Date().toISOString(),
                preferredClinician: '',
                assignedOffice: ''
            };
            await this.updateClientPreference(preference);
            await this.addAuditLog({
                timestamp: new Date().toISOString(),
                eventType: AuditEventType.CLIENT_PREFERENCES_UPDATED,
                description: `Processed accessibility form for client ${formData.clientId}`,
                user: 'SYSTEM',
                systemNotes: JSON.stringify(formData.formResponses)
            });
        }
        catch (error) {
            console.error('Error processing accessibility form:', error);
            await this.addAuditLog({
                timestamp: new Date().toISOString(),
                eventType: AuditEventType.SYSTEM_ERROR,
                description: `Failed to process accessibility form for client ${formData.clientId}`,
                user: 'SYSTEM',
                systemNotes: error instanceof Error ? error.message : 'Unknown error'
            });
            throw error;
        }
    }
    async refreshCache(range) {
        this.cache.invalidate(`sheet:${range}`);
    }
    clearCache() {
        this.cache.clearAll();
    }
}
exports.GoogleSheetsService = GoogleSheetsService;
exports.default = GoogleSheetsService;
