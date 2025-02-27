"use strict";
// src/lib/intakeq/appointment-sync.ts
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppointmentSyncHandler = void 0;
const scheduling_1 = require("../../types/scheduling");
class AppointmentSyncHandler {
    constructor(sheetsService, intakeQService // Optional service for API calls
    ) {
        this.sheetsService = sheetsService;
        this.intakeQService = intakeQService;
    }
    /**
     * Process appointment webhook events
     */
    processAppointmentEvent(payload) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!payload.Appointment) {
                return {
                    success: false,
                    error: 'Missing appointment data',
                    retryable: false
                };
            }
            try {
                // Log webhook receipt
                yield this.sheetsService.addAuditLog({
                    timestamp: new Date().toISOString(),
                    eventType: 'WEBHOOK_RECEIVED',
                    description: `Received ${payload.Type || payload.EventType} webhook`,
                    user: 'INTAKEQ_WEBHOOK',
                    systemNotes: JSON.stringify({
                        appointmentId: payload.Appointment.Id,
                        type: payload.Type || payload.EventType,
                        clientId: payload.ClientId
                    })
                });
                const eventType = payload.Type || payload.EventType;
                if (!eventType) {
                    return {
                        success: false,
                        error: 'Missing event type',
                        retryable: false
                    };
                }
                switch (eventType) {
                    case 'AppointmentCreated':
                    case 'Appointment Created':
                        return yield this.handleNewAppointment(payload.Appointment);
                    case 'AppointmentUpdated':
                    case 'Appointment Updated':
                    case 'AppointmentRescheduled':
                    case 'Appointment Rescheduled':
                        return yield this.handleAppointmentUpdate(payload.Appointment);
                    case 'AppointmentCancelled':
                    case 'Appointment Cancelled':
                    case 'AppointmentCanceled':
                    case 'Appointment Canceled':
                        return yield this.handleAppointmentCancellation(payload.Appointment);
                    case 'AppointmentDeleted':
                    case 'Appointment Deleted':
                        return yield this.handleAppointmentDeletion(payload.Appointment);
                    default:
                        return {
                            success: false,
                            error: `Unsupported event type: ${eventType}`,
                            retryable: false
                        };
                }
            }
            catch (error) {
                console.error('Appointment processing error:', error);
                // Log the error
                yield this.sheetsService.addAuditLog({
                    timestamp: new Date().toISOString(),
                    eventType: 'SYSTEM_ERROR',
                    description: `Error processing appointment ${payload.Appointment.Id}`,
                    user: 'SYSTEM',
                    systemNotes: error instanceof Error ? error.message : 'Unknown error'
                });
                return {
                    success: false,
                    error: error instanceof Error ? error.message : 'Unknown error',
                    retryable: true // Allow retry for unexpected errors
                };
            }
        });
    }
    handleNewAppointment(appointment) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                console.log('Processing new appointment:', appointment.Id);
                // 1. Convert IntakeQ appointment to our AppointmentRecord format
                const appointmentRecord = yield this.convertToAppointmentRecord(appointment);
                // 2. Find optimal office assignment
                const assignedOffice = yield this.determineOfficeAssignment(appointment);
                appointmentRecord.officeId = assignedOffice.officeId;
                // 3. Save appointment to Google Sheets
                yield this.sheetsService.addAppointment(appointmentRecord);
                // 4. Log success
                yield this.sheetsService.addAuditLog({
                    timestamp: new Date().toISOString(),
                    eventType: 'APPOINTMENT_CREATED',
                    description: `Added appointment ${appointment.Id}`,
                    user: 'SYSTEM',
                    systemNotes: JSON.stringify({
                        appointmentId: appointment.Id,
                        officeId: assignedOffice.officeId,
                        clientId: appointment.ClientId
                    })
                });
                return {
                    success: true,
                    details: {
                        appointmentId: appointment.Id,
                        officeId: assignedOffice.officeId,
                        action: 'created'
                    }
                };
            }
            catch (error) {
                console.error('Error handling new appointment:', error);
                throw error;
            }
        });
    }
    handleAppointmentUpdate(appointment) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                console.log('Processing appointment update:', appointment.Id);
                // 1. Check if appointment exists
                const existingAppointment = yield this.sheetsService.getAppointment(appointment.Id);
                if (!existingAppointment) {
                    // If appointment doesn't exist, treat it as a new appointment
                    return this.handleNewAppointment(appointment);
                }
                // 2. Convert IntakeQ appointment to our AppointmentRecord format
                const appointmentRecord = yield this.convertToAppointmentRecord(appointment);
                // 3. Determine if office reassignment is needed
                const currentOfficeId = existingAppointment.officeId;
                let newOfficeId = currentOfficeId;
                // Check if time or clinician changed, which would require reassignment
                const timeChanged = appointmentRecord.startTime !== existingAppointment.startTime ||
                    appointmentRecord.endTime !== existingAppointment.endTime;
                const clinicianChanged = appointmentRecord.clinicianId !== existingAppointment.clinicianId;
                if (timeChanged || clinicianChanged) {
                    const assignedOffice = yield this.determineOfficeAssignment(appointment);
                    newOfficeId = assignedOffice.officeId;
                }
                appointmentRecord.officeId = newOfficeId;
                // 4. Update appointment in Google Sheets
                yield this.sheetsService.updateAppointment(appointmentRecord);
                // 5. Log success
                yield this.sheetsService.addAuditLog({
                    timestamp: new Date().toISOString(),
                    eventType: 'APPOINTMENT_UPDATED',
                    description: `Updated appointment ${appointment.Id}`,
                    user: 'SYSTEM',
                    previousValue: JSON.stringify(existingAppointment),
                    newValue: JSON.stringify(appointmentRecord)
                });
                return {
                    success: true,
                    details: {
                        appointmentId: appointment.Id,
                        officeId: newOfficeId,
                        action: 'updated',
                        officeReassigned: newOfficeId !== currentOfficeId
                    }
                };
            }
            catch (error) {
                console.error('Error handling appointment update:', error);
                throw error;
            }
        });
    }
    handleAppointmentCancellation(appointment) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                console.log('Processing appointment cancellation:', appointment.Id);
                // 1. Check if appointment exists
                const existingAppointment = yield this.sheetsService.getAppointment(appointment.Id);
                if (!existingAppointment) {
                    return {
                        success: false,
                        error: `Appointment ${appointment.Id} not found for cancellation`,
                        retryable: false
                    };
                }
                // 2. Update appointment status to cancelled
                const updatedAppointment = Object.assign(Object.assign({}, existingAppointment), { status: 'cancelled', lastUpdated: new Date().toISOString() });
                // 3. Update appointment in Google Sheets
                yield this.sheetsService.updateAppointment(updatedAppointment);
                // 4. Log cancellation
                yield this.sheetsService.addAuditLog({
                    timestamp: new Date().toISOString(),
                    eventType: 'APPOINTMENT_CANCELLED',
                    description: `Cancelled appointment ${appointment.Id}`,
                    user: 'SYSTEM',
                    systemNotes: JSON.stringify({
                        appointmentId: appointment.Id,
                        clientId: appointment.ClientId,
                        reason: appointment.CancellationReason || 'No reason provided'
                    })
                });
                return {
                    success: true,
                    details: {
                        appointmentId: appointment.Id,
                        action: 'cancelled'
                    }
                };
            }
            catch (error) {
                console.error('Error handling appointment cancellation:', error);
                throw error;
            }
        });
    }
    handleAppointmentDeletion(appointment) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                console.log('Processing appointment deletion:', appointment.Id);
                // 1. Check if appointment exists
                const existingAppointment = yield this.sheetsService.getAppointment(appointment.Id);
                if (!existingAppointment) {
                    return {
                        success: false,
                        error: `Appointment ${appointment.Id} not found for deletion`,
                        retryable: false
                    };
                }
                // 2. Delete appointment from Google Sheets
                yield this.sheetsService.deleteAppointment(appointment.Id);
                // 3. Log deletion
                yield this.sheetsService.addAuditLog({
                    timestamp: new Date().toISOString(),
                    eventType: 'APPOINTMENT_DELETED',
                    description: `Deleted appointment ${appointment.Id}`,
                    user: 'SYSTEM',
                    systemNotes: JSON.stringify({
                        appointmentId: appointment.Id,
                        clientId: appointment.ClientId
                    })
                });
                return {
                    success: true,
                    details: {
                        appointmentId: appointment.Id,
                        action: 'deleted'
                    }
                };
            }
            catch (error) {
                console.error('Error handling appointment deletion:', error);
                throw error;
            }
        });
    }
    /**
     * Convert IntakeQ appointment to our AppointmentRecord format
     */
    convertToAppointmentRecord(appointment) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                // Get all clinicians to find the matching one
                const clinicians = yield this.sheetsService.getClinicians();
                // Find clinician by IntakeQ practitioner ID
                const clinician = clinicians.find(c => c.intakeQPractitionerId === appointment.PractitionerId);
                if (!clinician) {
                    console.warn(`No mapping found for IntakeQ practitioner ID: ${appointment.PractitionerId}, using raw data`);
                }
                // Convert the appointment to our format
                return {
                    appointmentId: appointment.Id,
                    clientId: appointment.ClientId.toString(),
                    clientName: appointment.ClientName,
                    clinicianId: (clinician === null || clinician === void 0 ? void 0 : clinician.clinicianId) || appointment.PractitionerId,
                    clinicianName: (clinician === null || clinician === void 0 ? void 0 : clinician.name) || appointment.PractitionerName,
                    officeId: 'B-1', // Default to be replaced by office assignment
                    sessionType: this.determineSessionType(appointment),
                    startTime: appointment.StartDateIso,
                    endTime: appointment.EndDateIso,
                    status: 'scheduled',
                    lastUpdated: new Date().toISOString(),
                    source: 'intakeq',
                    requirements: yield this.determineRequirements(appointment),
                    notes: `Service: ${appointment.ServiceName}`
                };
            }
            catch (error) {
                console.error('Error converting appointment:', error);
                throw new Error(`Failed to convert appointment: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
        });
    }
    /**
     * Determine any special requirements for the appointment
     */
    determineRequirements(appointment) {
        return __awaiter(this, void 0, void 0, function* () {
            // Try to find client preferences
            const preferences = yield this.sheetsService.getClientPreferences();
            const clientPreference = preferences.find(p => p.clientId === appointment.ClientId.toString());
            if (!clientPreference) {
                return { accessibility: false, specialFeatures: [] };
            }
            // Process accessibility requirements
            return {
                accessibility: Array.isArray(clientPreference.mobilityNeeds) &&
                    clientPreference.mobilityNeeds.length > 0,
                specialFeatures: [
                    ...(Array.isArray(clientPreference.sensoryPreferences) ? clientPreference.sensoryPreferences : []),
                    ...(Array.isArray(clientPreference.physicalNeeds) ? clientPreference.physicalNeeds : [])
                ]
            };
        });
    }
    /**
     * Determine the session type based on appointment details
     */
    determineSessionType(appointment) {
        const serviceName = appointment.ServiceName.toLowerCase();
        // Map commonly used telehealth terms
        if (serviceName.match(/tele(health|therapy|med|session)|virtual|remote|video/)) {
            return 'telehealth';
        }
        // Map group therapy variations
        if (serviceName.match(/group|workshop|class|seminar/)) {
            return 'group';
        }
        // Map family therapy variations
        if (serviceName.match(/family|couples|relationship|parental|parent-child/)) {
            return 'family';
        }
        // Default to in-person if no other matches
        return 'in-person';
    }
    /**
     * Determine best office assignment for an appointment
     * This is a simplified version until we implement the full office assignment logic
     */
    determineOfficeAssignment(appointment) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                // Get all offices
                const offices = yield this.sheetsService.getOffices();
                // Get client preferences
                const preferences = yield this.sheetsService.getClientPreferences();
                const clientPreference = preferences.find(p => p.clientId === appointment.ClientId.toString());
                // Check if client has a preferred or previously assigned office
                if (clientPreference === null || clientPreference === void 0 ? void 0 : clientPreference.assignedOffice) {
                    const office = offices.find(o => (0, scheduling_1.standardizeOfficeId)(o.officeId) === (0, scheduling_1.standardizeOfficeId)(clientPreference.assignedOffice));
                    if (office && office.inService) {
                        return {
                            officeId: (0, scheduling_1.standardizeOfficeId)(clientPreference.assignedOffice),
                            reasons: ['Client has preferred office']
                        };
                    }
                }
                // Find all active offices
                const activeOffices = offices.filter(o => o.inService);
                if (activeOffices.length === 0) {
                    return {
                        officeId: 'B-1',
                        reasons: ['No active offices found, using default']
                    };
                }
                // Get clinicians to find office preferences
                const clinicians = yield this.sheetsService.getClinicians();
                const clinician = clinicians.find(c => c.intakeQPractitionerId === appointment.PractitionerId);
                // If clinician has preferred offices, use the first available one
                if (clinician && clinician.preferredOffices.length > 0) {
                    for (const preferredId of clinician.preferredOffices) {
                        const office = activeOffices.find(o => (0, scheduling_1.standardizeOfficeId)(o.officeId) === (0, scheduling_1.standardizeOfficeId)(preferredId));
                        if (office) {
                            return {
                                officeId: (0, scheduling_1.standardizeOfficeId)(office.officeId),
                                reasons: ['Clinician preferred office']
                            };
                        }
                    }
                }
                // Check if client has accessibility needs
                const hasAccessibilityNeeds = clientPreference &&
                    Array.isArray(clientPreference.mobilityNeeds) &&
                    clientPreference.mobilityNeeds.length > 0;
                if (hasAccessibilityNeeds) {
                    const accessibleOffices = activeOffices.filter(o => o.isAccessible);
                    if (accessibleOffices.length > 0) {
                        return {
                            officeId: (0, scheduling_1.standardizeOfficeId)(accessibleOffices[0].officeId),
                            reasons: ['Accessible office for client with mobility needs']
                        };
                    }
                }
                // For telehealth, assign a virtual office
                if (this.determineSessionType(appointment) === 'telehealth') {
                    return {
                        officeId: 'A-v',
                        reasons: ['Telehealth session']
                    };
                }
                // Default: assign first available office
                return {
                    officeId: (0, scheduling_1.standardizeOfficeId)(activeOffices[0].officeId),
                    reasons: ['Default assignment']
                };
            }
            catch (error) {
                console.error('Error determining office assignment:', error);
                // Fall back to default office
                return {
                    officeId: 'B-1',
                    reasons: ['Error in assignment process, using default']
                };
            }
        });
    }
}
exports.AppointmentSyncHandler = AppointmentSyncHandler;
exports.default = AppointmentSyncHandler;
