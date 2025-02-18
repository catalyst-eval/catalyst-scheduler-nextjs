// src/app/api/scheduling/test-daily/route.ts

import { NextResponse } from 'next/server';
import { initializeGoogleSheets } from '@/lib/google/auth';
import { IntakeQService } from '@/lib/intakeq/service';
import { initializeEmailService } from '@/lib/email/config';
import { EmailTemplates } from '@/lib/email/templates';
import { DailyAssignmentService } from '@/lib/scheduling/daily-assignment-service';
import { RecipientManagementService } from '@/lib/email/recipients';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const requestedDate = searchParams.get('date') || '2025-02-17';
    const testType = searchParams.get('test');
    
    console.log('Starting daily schedule test for:', requestedDate);
    
    // Create date in EST
    const targetDate = new Date(requestedDate + 'T12:00:00.000Z'); // Use noon to avoid timezone edge cases
    const estDateStr = targetDate.toLocaleString('en-US', { 
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
    
    console.log('Timezone handling:', {
      requested: requestedDate,
      estDate: estDateStr,
      isoString: targetDate.toISOString()
    });
    
    // Convert to ISO string for consistency
    const dateStr = targetDate.toISOString();
    
    console.log('Date configuration:', {
      requested: requestedDate,
      target: dateStr,
      estLocal: targetDate.toLocaleString('en-US', { timeZone: 'America/New_York' })
    });
    
    // Initialize services
    const sheetsService = await initializeGoogleSheets();
    console.log('Sheets service initialized');
    
    const intakeQService = new IntakeQService(
      process.env.INTAKEQ_API_KEY!,
      sheetsService
    );
    console.log('IntakeQ service initialized');

    const emailService = await initializeEmailService(sheetsService);
    console.log('Email service initialized');

    // Get today's date in EST/EDT
    const estDate = new Date(targetDate.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    console.log('Testing for date:', estDate.toISOString().split('T')[0]);

    // Test IntakeQ connection
    const connected = await intakeQService.testConnection();
    console.log('IntakeQ connection test:', connected);

    if (!connected) {
      throw new Error('Failed to connect to IntakeQ');
    }

    // Get appointments for the full target date
    const startOfDay = `${dateStr.split('T')[0]}T00:00:00Z`;
    const endOfDay = `${dateStr.split('T')[0]}T23:59:59Z`;
    
    console.log('Appointment search range:', {
      startOfDay,
      endOfDay,
      timezone: 'UTC'
    });

    const appointments = await intakeQService.getAppointments(
      startOfDay,
      endOfDay
    );
    console.log('Retrieved appointments:', appointments.length);

    // Use DailyAssignmentService to get full summary with office assignments
    const assignmentService = new DailyAssignmentService(
      sheetsService,
      intakeQService
    );
    const summary = await assignmentService.generateDailySummary(dateStr);
    console.log('Generated daily summary:', {
      appointments: summary.appointments.length,
      conflicts: summary.conflicts.length,
      alerts: summary.alerts.length
    });

    // Create email template
    const template = EmailTemplates.dailySchedule(summary);
    console.log('Created email template');

    // Send test email
    await emailService.sendEmail(
      [{
        email: 'tyler@bridgefamilytherapy.com',
        name: 'Tyler',
        role: 'admin',
        preferences: {
          dailySchedule: true,
          conflicts: true,
          errors: true
        }
      }],
      template,
      {
        type: 'schedule',
        priority: summary.alerts.some(a => a.severity === 'high') ? 'high' : 'normal',
        retryCount: 3
      }
    );
    console.log('Email sent successfully');

    return NextResponse.json({
      success: true,
      data: {
        date: dateStr,
        appointments: summary.appointments.map(appt => ({
          id: appt.appointmentId,
          clientId: appt.clientId,
          officeId: appt.officeId,
          startTime: appt.startTime,
          endTime: appt.endTime,
          sessionType: appt.sessionType
        })),
        conflicts: summary.conflicts,
        alerts: summary.alerts
      }
    });

  } catch (error) {
    console.error('Daily schedule test error:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      },
      { status: 500 }
    );
  }
}// src/app/api/scheduling/reset/route.ts
import { NextResponse } from 'next/server';
import { initializeGoogleSheets } from '@/lib/google/auth';

export async function POST(request: Request) {
  try {
    const sheetsService = await initializeGoogleSheets();
    
    // Get all appointments
    const appointments = await sheetsService.getAppointments(
      new Date().toISOString(),
      new Date(2025, 11, 31).toISOString()
    );
    
    // Delete all appointments
    for (const appt of appointments) {
      await sheetsService.deleteAppointment(appt.appointmentId);
    }

    // Clear cache
    sheetsService.clearCache();

    return NextResponse.json({
      success: true,
      message: 'Database reset complete'
    });
  } catch (error) {
    console.error('Reset error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}// src/app/api/scheduling/cleanup/route.ts
import { NextResponse } from 'next/server';
import { initializeGoogleSheets } from '@/lib/google/auth';

export async function POST(request: Request) {
  try {
    const sheetsService = await initializeGoogleSheets();
    const appointments = await sheetsService.getAppointments(
      new Date().toISOString(),
      new Date(2025, 11, 31).toISOString()
    );
    
    let deletedCount = 0;
    for (const appt of appointments) {
      // Delete if:
      // 1. It's a test appointment
      // 2. Has invalid data
      if (
        appt.appointmentId.startsWith('test') ||
        !appt.startTime ||
        appt.startTime === 'scheduled' ||
        appt.officeId.includes('T')
      ) {
        await sheetsService.deleteAppointment(appt.appointmentId);
        deletedCount++;
      }
    }

    // Clear cache
    sheetsService.clearCache();

    return NextResponse.json({
      success: true,
      deleted: deletedCount
    });
  } catch (error) {
    console.error('Cleanup error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}// src/app/api/scheduling/daily-assignments/route.ts

import { NextResponse } from 'next/server';
import { initializeGoogleSheets } from '@/lib/google/auth';
import { initializeEmailService } from '@/lib/email/config';
import { RecipientManagementService } from '@/lib/email/recipients';
import { IntakeQService } from '@/lib/intakeq/service';
import { DailyAssignmentService } from '@/lib/scheduling/daily-assignment-service';
import { EmailTemplates } from '@/lib/email/templates';

export async function GET(request: Request) {
  try {
    // Initialize services
    const sheetsService = await initializeGoogleSheets();
    const emailService = await initializeEmailService(sheetsService);
    const intakeQService = new IntakeQService(
      process.env.INTAKEQ_API_KEY!,
      sheetsService
    );
    const recipientService = new RecipientManagementService(sheetsService);

    // Get date from query parameters or use today
    const url = new URL(request.url);
    const targetDate = url.searchParams.get('date') || new Date().toISOString().split('T')[0];
    console.log('Generating assignments for:', targetDate);

    // Test IntakeQ connection
    console.log('Testing IntakeQ connection...');
    const connected = await intakeQService.testConnection();
    if (!connected) {
      console.error('Failed to connect to IntakeQ API');
      return NextResponse.json(
        { 
          success: false, 
          error: 'Failed to connect to IntakeQ API'
        },
        { status: 500 }
      );
    }
    console.log('IntakeQ connection successful');
    
    // Generate daily summary with both services
    const dailyAssignmentService = new DailyAssignmentService(
      sheetsService,
      intakeQService
    );
    
    console.log('Fetching daily summary...');
    const summary = await dailyAssignmentService.generateDailySummary(targetDate);
    console.log('Summary generated with', summary.appointments.length, 'appointments');

    // Get recipients and send email
    const recipients = await recipientService.getDailyScheduleRecipients();
    const template = EmailTemplates.dailySchedule(summary);
    
    console.log('Sending email to', recipients.length, 'recipients');
    await emailService.sendEmail(recipients, template, {
      type: 'schedule',
      priority: summary.alerts.some(a => a.severity === 'high') ? 'high' : 'normal',
      retryCount: 3
    });

    return NextResponse.json({
      success: true,
      data: {
        date: targetDate,
        appointmentCount: summary.appointments.length,
        conflicts: summary.conflicts,
        alerts: summary.alerts,
        officeUtilization: Object.fromEntries(summary.officeUtilization),
        recipientCount: recipients.length
      }
    });

  } catch (error) {
    console.error('Error processing daily assignments:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : 'Failed to process daily assignments'
      },
      { status: 500 }
    );
  }
}// src/app/api/webhooks/intakeq/route.ts
import { NextResponse } from 'next/server';
import { initializeGoogleSheets } from '@/lib/google/auth';
import { AppointmentHandler } from '@/lib/intakeq/appointment-handler';

export async function POST(request: Request) {
  try {
    // Get raw body
    const rawBody = await request.text();

    console.log('Webhook request received:', {
      bodyLength: rawBody.length
    });

    // Initialize services
    const sheetsService = await initializeGoogleSheets();
    console.log('Sheets service initialized');

    // Parse payload
    const payload = JSON.parse(rawBody);
    console.log('Processing webhook:', {
      type: payload.Type || payload.EventType,
      clientId: payload.ClientId,
      appointmentId: payload.Appointment?.Id,
      startDate: payload.Appointment?.StartDateIso,
      duration: payload.Appointment?.Duration
    });

    // Handle appointment events
    if ((payload.Type || payload.EventType)?.startsWith('Appointment')) {
      console.log('Creating appointment handler');
      const handler = new AppointmentHandler(sheetsService);
      console.log('Processing appointment with handler');
      const result = await handler.handleAppointment(payload);
      console.log('Handler result:', result);

      if (!result.success) {
        throw new Error(result.error || 'Failed to process appointment');
      }
    }

    console.log('Webhook processed successfully');
    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Webhook error:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    }, { status: 500 });
  }
}// src/config/constants.ts

/**
 * System Configuration Constants
 */

// IntakeQ Form IDs
export const INTAKEQ_FORMS = {
    ACCESSIBILITY_PREFERENCES: '67a52367e11d09a2b82d57a9'
  } as const;
  
  // Scheduling Constants
  export const SCHEDULING = {
    DEFAULT_APPOINTMENT_DURATION: 60, // minutes
    MIN_APPOINTMENT_DURATION: 30,     // minutes
    MAX_APPOINTMENT_DURATION: 180,    // minutes
    BUSINESS_HOURS: {
      START: 7,  // 7 AM
      END: 21    // 9 PM
    },
    OFFICE_CAPACITY: {
      DEFAULT: 2,
      LARGE_ROOM: 3,
      GROUP_ROOM: 8
    }
  } as const;
  
  // Email Configuration
  export const EMAIL = {
    RETRY_COUNT: 3,
    RETRY_DELAY: 1000, // ms
    TEMPLATES: {
      DAILY_SCHEDULE: 'daily-schedule',
      CONFLICT_ALERT: 'conflict-alert',
      ERROR_NOTIFICATION: 'error-notification'
    },
    PRIORITY: {
      HIGH: 'high',
      NORMAL: 'normal',
      LOW: 'low'
    } as const
  } as const;
  
  // Cache Configuration
  export const CACHE = {
    TTL: {
      OFFICES: 60000,        // 1 minute
      CLINICIANS: 300000,    // 5 minutes
      APPOINTMENTS: 30000,   // 30 seconds
      CONFIG: 3600000       // 1 hour
    }
  } as const;
  
  // Feature Flags
  export const FEATURES = {
    USE_EMAIL_NOTIFICATIONS: true,
    USE_CACHE: true,
    STRICT_VALIDATION: true,
    DEBUG_MODE: process.env.NODE_ENV === 'development',
    AUDIT_LOGGING: true
  } as const;
  
  // API Rate Limits
  export const API_LIMITS = {
    WEBHOOK: {
      MAX_REQUESTS: 100,
      WINDOW_MS: 60000  // 1 minute
    },
    SHEETS: {
      MAX_REQUESTS: 500,
      WINDOW_MS: 300000 // 5 minutes
    }
  } as const;
  
  // Error Messages
  export const ERROR_MESSAGES = {
    SCHEDULING: {
      CONFLICT: 'Schedule conflict detected',
      INVALID_TIME: 'Invalid appointment time',
      CAPACITY_EXCEEDED: 'Office capacity exceeded',
      NO_OFFICE: 'No suitable office found'
    },
    WEBHOOK: {
      INVALID_PAYLOAD: 'Invalid webhook payload',
      MISSING_FIELDS: 'Missing required fields',
      UNSUPPORTED_TYPE: 'Unsupported event type'
    },
    SHEETS: {
      CONNECTION_FAILED: 'Failed to connect to Google Sheets',
      READ_ERROR: 'Failed to read sheet data',
      WRITE_ERROR: 'Failed to write to sheet'
    }
  } as const;// src/lib/transformations/appointment-types.ts

import type { IntakeQAppointment } from '@/types/webhooks';
import type { 
  AppointmentRecord, 
  SessionType, 
  AlertSeverity 
} from '@/types/scheduling';

export const SESSION_TYPES = ['in-person', 'telehealth', 'group', 'family'] as const;
export const ALERT_SEVERITIES = ['high', 'medium', 'low'] as const;
export const APPOINTMENT_STATUSES = ['scheduled', 'completed', 'cancelled', 'rescheduled'] as const;

export type AppointmentStatus = typeof APPOINTMENT_STATUSES[number];
export type EmailPriority = 'high' | 'normal';

export function isSessionType(value: string): value is SessionType {
  return SESSION_TYPES.includes(value as SessionType);
}

export function isAlertSeverity(value: string): value is AlertSeverity {
  return ALERT_SEVERITIES.includes(value as AlertSeverity);
}

export function determineSessionType(serviceName: string): SessionType {
  const name = serviceName.toLowerCase();
  if (name.includes('telehealth') || name.includes('virtual')) return 'telehealth';
  if (name.includes('group')) return 'group';
  if (name.includes('family')) return 'family';
  return 'in-person';
}

export function mapAppointmentStatus(status: string): AppointmentStatus {
  const normalizedStatus = status.toLowerCase();
  switch (normalizedStatus) {
    case 'cancelled':
    case 'canceled':
      return 'cancelled';
    case 'completed':
    case 'done':
      return 'completed';
    case 'rescheduled':
      return 'rescheduled';
    default:
      return 'scheduled';
  }
}

export function mapEmailPriorityToAlertSeverity(priority: EmailPriority): AlertSeverity {
  switch (priority) {
    case 'high':
      return 'high';
    case 'normal':
      return 'medium';
  }
}

export function mapAlertSeverityToEmailPriority(severity: AlertSeverity): EmailPriority {
  switch (severity) {
    case 'high':
      return 'high';
    case 'medium':
    case 'low':
      return 'normal';
  }
}

export function transformIntakeQAppointment(appt: IntakeQAppointment): AppointmentRecord {
  return {
    appointmentId: appt.Id,
    clientId: appt.ClientId.toString(),
    clinicianId: appt.PractitionerId,
    officeId: '', // Default empty until assigned
    sessionType: determineSessionType(appt.ServiceName),
    requirements: {
      accessibility: false,
      specialFeatures: []
    },
    startTime: appt.StartDateIso,
    endTime: appt.EndDateIso,
    status: mapAppointmentStatus(appt.Status),
    lastUpdated: new Date(appt.DateCreated * 1000).toISOString(),
    source: 'intakeq' as const
  };
}// src/lib/test/clinician-mapping.ts
import { GoogleSheetsService } from '../google/sheets';

export async function testClinicianMapping(
  sheetsService: GoogleSheetsService,
  practitionerId: string
): Promise<{
  found: boolean;
  practitionerId: string;
  matchedClinician?: {
    clinicianId: string;
    name: string;
    intakeQPractitionerId: string;
  };
  allClinicians: Array<{
    clinicianId: string;
    name: string;
    intakeQPractitionerId: string;
  }>;
}> {
  // Get all clinicians
  const clinicians = await sheetsService.getClinicians();
  
  // Log all clinician data for debugging
  console.log('All clinicians:', clinicians.map(c => ({
    clinicianId: c.clinicianId,
    name: c.name,
    intakeQId: c.intakeQPractitionerId
  })));

  // Find matching clinician
  const matchedClinician = clinicians.find(
    c => c.intakeQPractitionerId === practitionerId
  );

  // Return test results
  return {
    found: !!matchedClinician,
    practitionerId,
    matchedClinician: matchedClinician ? {
      clinicianId: matchedClinician.clinicianId,
      name: matchedClinician.name,
      intakeQPractitionerId: matchedClinician.intakeQPractitionerId
    } : undefined,
    allClinicians: clinicians.map(c => ({
      clinicianId: c.clinicianId,
      name: c.name,
      intakeQPractitionerId: c.intakeQPractitionerId
    }))
  };
}// src/lib/util/date-helpers.ts

/**
 * Convert a date to Eastern Time
 */
export function toEST(date: string | Date): Date {
    const d = typeof date === 'string' ? new Date(date) : date;
    return new Date(d.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  }
  
  /**
   * Format a date for display in Eastern Time
   */
  export function formatESTTime(isoTime: string): string {
    const date = toEST(isoTime);
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: 'America/New_York'
    });
  }
  
  /**
   * Get start and end of day in EST
   */
  export function getESTDayRange(date: string): { start: string; end: string } {
    const estDate = toEST(date);
    const startOfDay = new Date(estDate);
    startOfDay.setHours(0, 0, 0, 0);
    
    const endOfDay = new Date(estDate);
    endOfDay.setHours(23, 59, 59, 999);
  
    return {
      start: startOfDay.toISOString(),
      end: endOfDay.toISOString()
    };
  }
  
  /**
   * Compare two dates ignoring time
   */
  export function isSameESTDay(date1: string | Date, date2: string | Date): boolean {
    const d1 = toEST(date1);
    const d2 = toEST(date2);
    
    return d1.getFullYear() === d2.getFullYear() &&
           d1.getMonth() === d2.getMonth() &&
           d1.getDate() === d2.getDate();
  }
  
  /**
   * Format a date range for display
   */
  export function formatDateRange(startTime: string, endTime: string): string {
    const start = toEST(startTime);
    const end = toEST(endTime);
    
    return `${formatESTTime(startTime)} - ${formatESTTime(endTime)}`;
  }
  
  /**
   * Get a user-friendly date string in EST
   */
  export function getDisplayDate(date: string): string {
    const estDate = toEST(date);
    return estDate.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      timeZone: 'America/New_York'
    });
  }// src/lib/scheduling/conflict-resolution.ts

import type { 
  SessionType,
  SchedulingRequest,
  SchedulingConflict
} from '@/types/scheduling';

import type { SheetOffice } from '@/types/sheets';

export class ConflictResolutionService {
  constructor(
    private readonly availableOffices: SheetOffice[],
    private readonly existingBookings: Map<string, SchedulingRequest[]> // officeId -> bookings
  ) {}

  /**
   * Get session priority level
   */
  private getSessionPriority(sessionType: SessionType): number {
    switch (sessionType) {
      case 'in-person':
        return 100; // Highest priority
      case 'group':
      case 'family':
        return 75;  // High priority but below individual in-person
      case 'telehealth':
        return 25;  // Lowest priority, can be relocated
      default:
        return 50;
    }
  }

  /**
   * Check if an office has conflicts with the requested time slot
   */
  public async checkConflicts(
    officeId: string,
    request: SchedulingRequest
  ): Promise<SchedulingConflict[]> {
    const conflicts: SchedulingConflict[] = [];
    const existingBookings = this.existingBookings.get(officeId) || [];

    const requestStart = new Date(request.dateTime).getTime();
    const requestEnd = requestStart + (request.duration * 60 * 1000);

    for (const booking of existingBookings) {
      const bookingStart = new Date(booking.dateTime).getTime();
      const bookingEnd = bookingStart + (booking.duration * 60 * 1000);

      // Check for time overlap
      if (requestStart < bookingEnd && requestEnd > bookingStart) {
        // We have a conflict
        const conflict: SchedulingConflict = {
          officeId,
          existingBooking: booking,
          resolution: await this.resolveConflict(booking, request)
        };
        conflicts.push(conflict);
      }
    }

    return conflicts;
  }

  /**
   * Attempt to resolve a scheduling conflict
   */
  private async resolveConflict(
    existingBooking: SchedulingRequest,
    newRequest: SchedulingRequest
  ): Promise<{ type: 'relocate' | 'cannot-relocate'; reason: string; newOfficeId?: string }> {
    const existingPriority = this.getSessionPriority(existingBooking.sessionType);
    const newPriority = this.getSessionPriority(newRequest.sessionType);

    // If new booking is lower priority, don't relocate existing
    if (newPriority <= existingPriority) {
      return {
        type: 'cannot-relocate',
        reason: `Existing ${existingBooking.sessionType} session has priority over new ${newRequest.sessionType} session`
      };
    }

    // Try to find alternative office for existing booking
    const alternativeOffice = await this.findAlternativeOffice(existingBooking);
    if (alternativeOffice) {
      return {
        type: 'relocate',
        reason: `${newRequest.sessionType} takes priority, relocating existing ${existingBooking.sessionType} to ${alternativeOffice.officeId}`,
        newOfficeId: alternativeOffice.officeId
      };
    }

    return {
      type: 'cannot-relocate',
      reason: 'No alternative offices available for relocation'
    };
  }

  /**
   * Find an alternative office for a booking
   */
  private async findAlternativeOffice(
    booking: SchedulingRequest
  ): Promise<SheetOffice | null> {
    // Filter available offices based on booking requirements
    const validOffices = this.availableOffices.filter(office => {
      // Must be in service
      if (!office.inService) return false;

      // Check accessibility if required
      if (booking.requirements?.accessibility && !office.isAccessible) {
        return false;
      }

      // Check if office already has conflicts
      const officeBookings = this.existingBookings.get(office.officeId) || [];
      const hasConflicts = officeBookings.some(existing => {
        const existingStart = new Date(existing.dateTime).getTime();
        const existingEnd = existingStart + (existing.duration * 60 * 1000);
        const bookingStart = new Date(booking.dateTime).getTime();
        const bookingEnd = bookingStart + (booking.duration * 60 * 1000);

        return bookingStart < existingEnd && bookingEnd > existingStart;
      });

      return !hasConflicts;
    });

    // Return first available office or null if none found
    return validOffices.length > 0 ? validOffices[0] : null;
  }
}// src/lib/scheduling/daily-assignment-service.ts

import { toEST, getESTDayRange, isSameESTDay } from '../util/date-helpers';
import type { 
  AppointmentRecord,
  SchedulingConflict 
} from '@/types/scheduling';
import type { 
  SheetOffice, 
  SheetClinician, 
  ClientPreference
} from '@/types/sheets';

import { GoogleSheetsService, AuditEventType } from '@/lib/google/sheets';
import type { IntakeQService } from '@/lib/intakeq/service';
import { OfficeAssignmentService } from './office-assignment';

interface DailyScheduleSummary {
  date: string;
  appointments: AppointmentRecord[];
  conflicts: Array<{
    type: 'double-booking' | 'accessibility' | 'capacity';
    description: string;
    severity: 'high' | 'medium' | 'low';
    officeId?: string;
    appointmentIds?: string[];
  }>;
  officeUtilization: Map<string, {
    totalSlots: number;
    bookedSlots: number;
    specialNotes?: string[];
  }>;
  alerts: Array<{
    type: 'accessibility' | 'capacity' | 'scheduling' | 'system';
    message: string;
    severity: 'high' | 'medium' | 'low';
  }>;
}

export class DailyAssignmentService {
  constructor(
    private readonly sheetsService: GoogleSheetsService,
    private readonly intakeQService: IntakeQService
  ) {}

  async generateDailySummary(date: string): Promise<DailyScheduleSummary> {
    try {
      console.log('Generating daily summary for:', date);
      
      // Get date range in EST
      const range = getESTDayRange(date);
const startOfDay = range.start;
const endOfDay = range.end;
      
      console.log('Date range for summary:', {
        requestedDate: date,
        startOfDay,
        endOfDay,
        estDate: toEST(date).toLocaleString('en-US', { timeZone: 'America/New_York' })
      });

      // Fetch all required data
      console.log('Fetching data...');
      const [intakeQAppointments, offices, clinicians, clientPreferences, localAppointments] = await Promise.all([
        this.intakeQService.getAppointments(startOfDay, endOfDay),
        this.sheetsService.getOffices(),
        this.sheetsService.getClinicians(),
        this.sheetsService.getClientPreferences(),
        this.sheetsService.getAppointments(startOfDay, endOfDay)
      ]);

      console.log('Found appointments:', {
        intakeQ: intakeQAppointments.length,
        local: localAppointments.length
      });

      // Create lookup maps
      const clinicianMap = new Map(
        clinicians.map(c => [c.intakeQPractitionerId, c]) // Map practitioner ID to clinician object
      );

      // Process appointments
      console.log('Processing IntakeQ appointments...');
      const processedIntakeQAppointments = await Promise.all(intakeQAppointments.map(async intakeQAppt => {
        // Get local appointment if exists
        const localAppt = localAppointments.find(appt => appt.appointmentId === intakeQAppt.Id);
        const clinician = clinicianMap.get(intakeQAppt.PractitionerId);

        // If no local appointment exists, assign an office
        let officeId = localAppt?.officeId;
        let notes = localAppt?.notes;

        if (!officeId && clinician) {
          const assignmentService = new OfficeAssignmentService(
            offices,
            await this.sheetsService.getAssignmentRules(),
            clinicians
          );

          const result = await assignmentService.findOptimalOffice({
            clientId: intakeQAppt.ClientId.toString(),
            clinicianId: clinician.clinicianId,
            dateTime: intakeQAppt.StartDateIso,
            duration: this.calculateDuration(intakeQAppt.StartDateIso, intakeQAppt.EndDateIso),
            sessionType: this.determineSessionType(intakeQAppt.ServiceName)
          });

          if (result.success) {
            officeId = result.officeId;
            notes = result.notes;
          }
        }

        return {
          appointmentId: intakeQAppt.Id,
          clientId: intakeQAppt.ClientId.toString(),
          clientName: intakeQAppt.ClientName,
          clinicianId: clinicianMap.get(intakeQAppt.PractitionerId)?.clinicianId || intakeQAppt.PractitionerId,
    clinicianName: clinicianMap.get(intakeQAppt.PractitionerId)?.name || 'Unknown',
          officeId: officeId || '',
          sessionType: this.determineSessionType(intakeQAppt.ServiceName),
          startTime: intakeQAppt.StartDateIso,
          endTime: intakeQAppt.EndDateIso,
          status: localAppt?.status || 'scheduled',
          lastUpdated: new Date().toISOString(),
          source: localAppt?.source || 'intakeq' as 'intakeq' | 'manual',
          requirements: localAppt?.requirements || {
            accessibility: false,
            specialFeatures: []
          },
          notes
        };
      }));

      // Sort appointments by time
      // Process local appointments that aren't from IntakeQ
      console.log('Processing local appointments...');
      const localOnlyAppointments = localAppointments.filter(
        local => !intakeQAppointments.some(intakeQ => intakeQ.Id === local.appointmentId)
      );

      console.log('Appointment counts:', {
        intakeQ: processedIntakeQAppointments.length,
        localOnly: localOnlyAppointments.length
      });

      // Combine all appointments
      const allAppointments = [...processedIntakeQAppointments, ...localOnlyAppointments];

      // Sort appointments by time
      allAppointments.sort((a, b) => {
        if (a.clinicianName < b.clinicianName) return -1;
        if (a.clinicianName > b.clinicianName) return 1;
        return new Date(a.startTime).getTime() - new Date(b.startTime).getTime();
      });

      // Create summary
      const summary: DailyScheduleSummary = {
        date,
        appointments: allAppointments,
        conflicts: [],
        officeUtilization: new Map(),
        alerts: []
      };

      // Process conflicts and generate alerts
      this.processAppointments(summary, allAppointments, offices, clinicians, clientPreferences);
      this.calculateOfficeUtilization(summary, offices);
      this.generateAlerts(summary);

      // Log summary
      await this.sheetsService.addAuditLog({
        timestamp: new Date().toISOString(),
        eventType: AuditEventType.DAILY_ASSIGNMENTS_UPDATED,
        description: `Generated daily summary for ${date}`,
        user: 'SYSTEM',
        systemNotes: JSON.stringify({
          appointmentCount: allAppointments.length,
          conflictCount: summary.conflicts.length,
          alertCount: summary.alerts.length
        })
      });

      console.log('Final summary:', {
        date,
        totalAppointments: summary.appointments.length,
        intakeQCount: processedIntakeQAppointments.length,
        localCount: localOnlyAppointments.length,
        conflicts: summary.conflicts.length,
        alerts: summary.alerts.length,
        sampleAppointments: summary.appointments.slice(0, 2).map(appt => ({
          id: appt.appointmentId,
          client: appt.clientName,
          time: appt.startTime
        }))
      });

      return summary;
    } catch (error) {
      console.error('Error generating daily summary:', error);
      throw error;
    }
  }

  private calculateDuration(startTime: string, endTime: string): number {
    const start = new Date(startTime);
    const end = new Date(endTime);
    return Math.round((end.getTime() - start.getTime()) / (60 * 1000));
  }

  private determineSessionType(serviceName: string): 'in-person' | 'telehealth' | 'group' | 'family' {
    const name = serviceName.toLowerCase();
    if (name.includes('telehealth') || name.includes('virtual')) return 'telehealth';
    if (name.includes('group')) return 'group';
    if (name.includes('family') || name.includes('relationship')) return 'family';
    return 'in-person';
  }

  private processAppointments(
    summary: DailyScheduleSummary,
    appointments: AppointmentRecord[],
    offices: SheetOffice[],
    clinicians: SheetClinician[],
    clientPreferences: ClientPreference[]
  ): void {
    appointments.forEach((appt1, i) => {
      // Check for overlapping appointments
      appointments.slice(i + 1).forEach(appt2 => {
        // Only check for overlaps if appointments are on the same day
        const sameDay = isSameESTDay(appt1.startTime, appt2.startTime);
        
        if (sameDay && this.appointmentsOverlap(appt1, appt2)) {
          // Skip telehealth appointments from conflict detection
          if (appt1.sessionType === 'telehealth' || appt2.sessionType === 'telehealth') {
            return;
          }
          
          // Check for same office conflicts
          if (appt1.officeId === appt2.officeId) {
            summary.conflicts.push({
              type: 'double-booking',
              description: `Schedule conflict in ${appt1.officeId}: ${appt1.clientName || appt1.clientId} and ${appt2.clientName || appt2.clientId}`,
              severity: 'high',
              officeId: appt1.officeId,
              appointmentIds: [appt1.appointmentId, appt2.appointmentId]
            });
          }
    
          // Check for clinician double-booking
          if (appt1.clinicianId === appt2.clinicianId) {
            summary.conflicts.push({
              type: 'double-booking',
              description: `${appt1.clinicianName || appt1.clinicianId} has overlapping appointments`,
              severity: 'high',
              appointmentIds: [appt1.appointmentId, appt2.appointmentId]
            });
          }
        }
      });
      // Check for overlapping appointments
      appointments.slice(i + 1).forEach(appt2 => {
        if (this.appointmentsOverlap(appt1, appt2)) {
          if (appt1.officeId === appt2.officeId) {
            summary.conflicts.push({
              type: 'double-booking',
              description: `Schedule conflict in ${appt1.officeId}: ${appt1.clientName} and ${appt2.clientName}`,
              severity: 'high',
              officeId: appt1.officeId,
              appointmentIds: [appt1.appointmentId, appt2.appointmentId]
            });
          }

          if (appt1.clinicianId === appt2.clinicianId) {
            summary.conflicts.push({
              type: 'double-booking',
              description: `${appt1.clinicianName} has overlapping appointments`,
              severity: 'high',
              appointmentIds: [appt1.appointmentId, appt2.appointmentId]
            });
          }
        }
      });

      // Check accessibility requirements
      const clientPref = clientPreferences.find(
        pref => pref.clientId === appt1.clientId
      );
      const office = offices.find(
        office => office.officeId === appt1.officeId
      );

      if (clientPref?.mobilityNeeds.length && office && !office.isAccessible) {
        summary.conflicts.push({
          type: 'accessibility',
          description: `${appt1.clientName} requires accessible office but assigned to ${appt1.officeId}`,
          severity: 'high',
          officeId: appt1.officeId,
          appointmentIds: [appt1.appointmentId]
        });
      }
    });
  }

  private calculateOfficeUtilization(
    summary: DailyScheduleSummary,
    offices: SheetOffice[]
  ): void {
    offices.forEach(office => {
      const officeAppointments = summary.appointments.filter(
        appt => appt.officeId === office.officeId
      );

      const totalSlots = 8; // 8-hour day
      const bookedSlots = officeAppointments.length;

      const notes: string[] = [];
      if (office.isFlexSpace) {
        notes.push('Flex space - coordinate with team');
      }
      if (bookedSlots / totalSlots > 0.9) {
        notes.push('Critical capacity warning');
      } else if (bookedSlots / totalSlots > 0.8) {
        notes.push('High utilization');
      }

      summary.officeUtilization.set(office.officeId, {
        totalSlots,
        bookedSlots,
        specialNotes: notes
      });
    });
  }

  private appointmentsOverlap(appt1: AppointmentRecord, appt2: AppointmentRecord): boolean {
    // Convert times to minutes since midnight for easier comparison
    const getMinutes = (time: string) => {
      const date = new Date(time);
      return date.getUTCHours() * 60 + date.getUTCMinutes();
    };
  
    const start1 = getMinutes(appt1.startTime);
    const end1 = start1 + this.getDurationMinutes(appt1.startTime, appt1.endTime);
    const start2 = getMinutes(appt2.startTime);
    const end2 = start2 + this.getDurationMinutes(appt2.startTime, appt2.endTime);
  
    console.log('Checking overlap:', {
      appt1: {
        id: appt1.appointmentId,
        client: appt1.clientName || appt1.clientId,
        start: start1,
        end: end1,
        time: new Date(appt1.startTime).toLocaleString()
      },
      appt2: {
        id: appt2.appointmentId,
        client: appt2.clientName || appt2.clientId,
        start: start2,
        end: end2,
        time: new Date(appt2.startTime).toLocaleString()
      }
    });
  
    // Check actual overlap
    return start1 < end2 && end1 > start2;
  }
  
  private getDurationMinutes(startTime: string, endTime: string): number {
    const start = new Date(startTime);
    const end = new Date(endTime);
    return Math.round((end.getTime() - start.getTime()) / (60 * 1000));
  }

  private generateAlerts(summary: DailyScheduleSummary): void {
    // Check high priority conflicts
    const highPriorityConflicts = summary.conflicts.filter(
      conflict => conflict.severity === 'high'
    );

    if (highPriorityConflicts.length > 0) {
      summary.alerts.push({
        type: 'scheduling',
        message: `${highPriorityConflicts.length} high-priority conflicts detected`,
        severity: 'high'
      });
    }

    // Check office capacity
    const highCapacityOffices = Array.from(summary.officeUtilization.entries())
      .filter(([_, data]) => data.bookedSlots / data.totalSlots > 0.8);

    if (highCapacityOffices.length > 0) {
      summary.alerts.push({
        type: 'capacity',
        message: `${highCapacityOffices.length} offices are at high capacity`,
        severity: 'medium'
      });
    }
  }
}// src/lib/scheduling/service.ts

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
}import type { 
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
}// src/lib/scheduling/daily-summary-service.ts

import type { 
    DailyScheduleSummary,
    AppointmentRecord
  } from '@/types/scheduling';
  import type { SheetOffice } from '@/types/sheets';
  
  export class DailySummaryService {
    constructor(
      private readonly offices: SheetOffice[],
      private readonly appointments: AppointmentRecord[]
    ) {}
  
    async generateDailySummary(date: string): Promise<DailyScheduleSummary> {
      const conflicts: DailyScheduleSummary['conflicts'] = [];
      const alerts: DailyScheduleSummary['alerts'] = [];
      const officeUtilization = new Map<string, {
        totalSlots: number;
        bookedSlots: number;
        specialNotes?: string[];
      }>();
  
      // Initialize office utilization
      this.offices.forEach(office => {
        const officeAppointments = this.appointments.filter(
          appt => appt.officeId === office.officeId
        );
  
        officeUtilization.set(office.officeId, {
          totalSlots: 8, // Assuming 8 hour workday
          bookedSlots: officeAppointments.length,
          specialNotes: office.isFlexSpace ? ['Flex space - coordinate with team'] : []
        });
  
        // Check utilization
        if (officeAppointments.length / 8 > 0.9) {
          alerts.push({
            type: 'capacity',
            message: `Office ${office.officeId} is near capacity (>90% booked)`,
            severity: 'high'
          });
        }
      });
  
      // Check for conflicts
      this.offices.forEach(office => {
        const officeAppointments = this.appointments.filter(
          appt => appt.officeId === office.officeId
        );
  
        officeAppointments.forEach((appt1, i) => {
          officeAppointments.slice(i + 1).forEach(appt2 => {
            const start1 = new Date(appt1.startTime);
            const end1 = new Date(appt1.endTime);
            const start2 = new Date(appt2.startTime);
            const end2 = new Date(appt2.endTime);
  
            if (start1 < end2 && end1 > start2) {
              conflicts.push({
                type: 'double-booking',
                description: `Schedule conflict in office ${office.officeId}`,
                severity: 'high',
                officeId: office.officeId,
                appointmentIds: [appt1.appointmentId, appt2.appointmentId]
              });
            }
          });
        });
      });
  
      return {
        date,
        appointments: this.appointments,
        conflicts,
        alerts,
        officeUtilization
      };
    }
  }// src/lib/google/sheets-cache.ts

interface CacheEntry<T> {
    data: T;
    timestamp: number;
  }
  
  interface CacheOptions {
    ttl: number; // Time to live in milliseconds
  }
  
  export class SheetsCacheService {
    private cache: Map<string, CacheEntry<any>> = new Map();
    private defaultTTL = 60000; // 1 minute default TTL
    private retryDelays = [1000, 2000, 4000, 8000]; // Exponential backoff delays
  
    constructor(private options?: CacheOptions) {}
  
    /**
     * Get data from cache or fetch using provided function
     */
    async getOrFetch<T>(
      key: string,
      fetchFn: () => Promise<T>,
      ttl: number = this.defaultTTL
    ): Promise<T> {
      const cached = this.cache.get(key);
      const now = Date.now();
  
      if (cached && now - cached.timestamp < ttl) {
        return cached.data;
      }
  
      // Implement exponential backoff for API calls
      let lastError;
      for (let i = 0; i < this.retryDelays.length; i++) {
        try {
          const data = await fetchFn();
          this.cache.set(key, { data, timestamp: now });
          return data;
        } catch (error) {
          lastError = error;
          if (this.isQuotaError(error)) {
            console.log(`Rate limit hit, retrying in ${this.retryDelays[i]}ms...`);
            await this.delay(this.retryDelays[i]);
            continue;
          }
          throw error;
        }
      }
  
      // If we've exhausted all retries
      if (cached) {
        console.warn('Returning stale data after fetch failures');
        return cached.data;
      }
  
      throw lastError;
    }
  
    /**
     * Clear specific cache entry
     */
    invalidate(key: string): void {
      this.cache.delete(key);
    }
  
    /**
     * Clear all cache entries
     */
    clearAll(): void {
      this.cache.clear();
    }
  
    /**
     * Check if error is a quota exceeded error
     */
    private isQuotaError(error: any): boolean {
      return (
        error?.response?.status === 429 ||
        error?.message?.includes('Quota exceeded') ||
        error?.code === 429
      );
    }
  
    /**
     * Delay promise
     */
    private delay(ms: number): Promise<void> {
      return new Promise(resolve => setTimeout(resolve, ms));
    }
  }// src/lib/google/sheets.ts

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
  CONFIG_UPDATED = 'CONFIG_UPDATED',
  RULE_CREATED = 'RULE_CREATED',
  RULE_UPDATED = 'RULE_UPDATED',
  CLIENT_PREFERENCES_UPDATED = 'CLIENT_PREFERENCES_UPDATED',
  CLIENT_OFFICE_ASSIGNED = 'CLIENT_OFFICE_ASSIGNED',
  APPOINTMENT_CREATED = 'APPOINTMENT_CREATED',
  APPOINTMENT_UPDATED = 'APPOINTMENT_UPDATED',
  APPOINTMENT_CANCELLED = 'APPOINTMENT_CANCELLED',
  APPOINTMENT_DELETED = 'APPOINTMENT_DELETED',
  SYSTEM_ERROR = 'SYSTEM_ERROR',
  WEBHOOK_RECEIVED = 'WEBHOOK_RECEIVED',
  INTEGRATION_UPDATED = 'INTEGRATION_UPDATED',
  DAILY_ASSIGNMENTS_UPDATED = 'DAILY_ASSIGNMENTS_UPDATED',
  CRITICAL_ERROR = 'CRITICAL_ERROR'
}

export class GoogleSheetsService {
  private sheets;
  private spreadsheetId: string;
  private cache: SheetsCacheService;

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
      specialFeatures: [], // Added required field with default empty array
      additionalNotes: row[8],
      lastUpdated: row[9],
      preferredClinician: row[10],
      assignedOffice: row[11]
    })) ?? [];
  }

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
      console.error('Failed audit log entry:', entry);
    }
  }

  async getRecentAuditLogs(limit: number = 5): Promise<AuditLogEntry[]> {
    try {
      const values = await this.readSheet('Audit Log!A2:G');
      
      if (!values) return [];
      
      if (!values || !Array.isArray(values)) {
        console.log('No appointments found in sheet');
        return [];
      }
      
      return values
        .map(row => ({
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
        
    } catch (error) {
      console.error('Error reading audit logs:', error);
      return [];
    }
  }

  async getOfficeAppointments(officeId: string, date: string): Promise<AppointmentRecord[]> {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    const appointments = await this.getAppointments(
      startOfDay.toISOString(),
      endOfDay.toISOString()
    );

    if (officeId === 'all') {
      return appointments;
    }

    return appointments.filter(appt => appt.officeId === officeId);
  }

  async addAppointment(appointment: AppointmentRecord): Promise<void> {
    try {
      const rowData = [
        appointment.appointmentId,
        appointment.clientId,
        appointment.clientName,
        appointment.clinicianId,
        appointment.clinicianName,
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
  
      await this.appendRows('Appointments!A:N', [rowData]);
  
      await this.addAuditLog({
        timestamp: new Date().toISOString(),
        eventType: AuditEventType.APPOINTMENT_CREATED,
        description: `Added appointment ${appointment.appointmentId}`,
        user: 'SYSTEM',
        systemNotes: JSON.stringify(appointment)
      });
  
      await this.refreshCache('Appointments!A2:N');
    } catch (error) {
      console.error('Error adding appointment:', error);
      throw new Error('Failed to add appointment');
    }
  }

  // In sheets.ts
async getAppointments(startDate: string, endDate: string): Promise<AppointmentRecord[]> {
  try {
    const values = await this.readSheet('Appointments!A2:N');
    
    if (!values || !Array.isArray(values)) {
      console.log('No appointments found in sheet');
      return [];
    }

    console.log('Processing appointments from sheet:', {
      rowCount: values.length,
      dateRange: { startDate, endDate }
    });

    const mappedAppointments: AppointmentRecord[] = values
      .map(row => {
        try {
          const appointment: AppointmentRecord = {
            appointmentId: row[0] || '',
            clientId: row[1] || '',
            clientName: row[2] || row[1] || '', // Use name if available, fall back to ID
            clinicianId: row[3] || '',
            clinicianName: row[4] || row[3] || '', // Use name if available, fall back to ID
            officeId: row[5] || '',
            sessionType: (row[6] || 'in-person') as 'in-person' | 'telehealth' | 'group' | 'family',
            startTime: row[7] || '',
            endTime: row[8] || '',
            status: (row[9] || 'scheduled') as 'scheduled' | 'completed' | 'cancelled' | 'rescheduled',
            lastUpdated: row[10] || new Date().toISOString(),
            source: (row[11] || 'manual') as 'intakeq' | 'manual',
            requirements: { accessibility: false, specialFeatures: [] },
            notes: ''
          };

          // Parse requirements JSON safely
          try {
            const requirementsStr = row[12]?.toString().trim();
            if (requirementsStr) {
              // Remove any control characters and clean the JSON string
              const cleanJson = requirementsStr
                .replace(/[\u0000-\u0019]+/g, '')
                .replace(/\s+/g, ' ')
                .trim();
              appointment.requirements = JSON.parse(cleanJson);
            }
          } catch (err) {
            console.error('Error parsing requirements JSON:', err, {value: row[12]});
          }

          // Add notes if present
          if (row[13]) {
            appointment.notes = row[13];
          }

          return appointment;
        } catch (error) {
          console.error('Error mapping appointment row:', error, { row });
          return null;
        }
      })
      .filter((appt): appt is AppointmentRecord => appt !== null)
      .filter(appt => {
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
        } catch (error) {
          console.error('Error filtering appointment:', error, { appt });
          return false;
        }
      });

    console.log('Appointment processing complete:', {
      totalFound: mappedAppointments.length,
      dateRange: { startDate, endDate }
    });

    return mappedAppointments;
  } catch (error) {
    console.error('Error reading appointments:', error);
    throw new Error('Failed to read appointments');
  }
}

  async updateAppointment(appointment: AppointmentRecord): Promise<void> {
    try {
      const values = await this.readSheet('Appointments!A:A');
      const appointmentRow = values?.findIndex(row => row[0] === appointment.appointmentId);

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
    } catch (error) {
      console.error('Error updating appointment:', error);
      throw new Error('Failed to update appointment');
    }
  }

  // Add after the updateAppointment method:
  async getAppointment(appointmentId: string): Promise<AppointmentRecord | null> {
    try {
      const values = await this.readSheet('Appointments!A2:N');
      if (!values) return null;
  
      const appointmentRow = values.find(row => row[0] === appointmentId);
      if (!appointmentRow) return null;
  
      return {
        appointmentId: appointmentRow[0],
        clientId: appointmentRow[1],
        clientName: appointmentRow[2],
        clinicianId: appointmentRow[3],
        clinicianName: appointmentRow[4],
        officeId: appointmentRow[5],
        sessionType: appointmentRow[6] as 'in-person' | 'telehealth' | 'group' | 'family',
        startTime: appointmentRow[7],
        endTime: appointmentRow[8],
        status: appointmentRow[9] as 'scheduled' | 'completed' | 'cancelled' | 'rescheduled',
        lastUpdated: appointmentRow[10],
        source: appointmentRow[11] as 'intakeq' | 'manual',
        requirements: JSON.parse(appointmentRow[12] || '{}'),
        notes: appointmentRow[13]
      };
    } catch (error) {
      console.error('Error getting appointment:', error);
      return null;
    }
  }


async deleteAppointment(appointmentId: string): Promise<void> {
  try {
    const values = await this.readSheet('Appointments!A:A');
    const appointmentRow = values?.findIndex(row => row[0] === appointmentId);

    if (!values || !appointmentRow || appointmentRow < 0) {
      throw new Error(`Appointment ${appointmentId} not found`);
    }

    await this.sheets.spreadsheets.values.clear({
      spreadsheetId: this.spreadsheetId,
      range: `Appointments!A${appointmentRow + 1}:L${appointmentRow + 1}`
    });

    await this.refreshCache('Appointments!A2:N');
  } catch (error) {
    console.error('Error deleting appointment:', error);
    throw new Error('Failed to delete appointment');
  }
}

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
        await this.sheets.spreadsheets.values.update({
          spreadsheetId: this.spreadsheetId,
          range: `Client Preferences!A${clientRow + 1}`,
          valueInputOption: 'RAW',
          requestBody: {
            values: [rowData]
          }
        });
      } else {
        await this.appendRows('Client Preferences!A:L',
          [rowData]);
        }
  
        await this.addAuditLog({
          timestamp: new Date().toISOString(),
          eventType: AuditEventType.CLIENT_PREFERENCES_UPDATED,
          description: `Updated preferences for client ${preference.clientId}`,
          user: 'SYSTEM',
          systemNotes: JSON.stringify(preference)
        });
  
        await this.refreshCache('Client Preferences!A2:L');
  
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
  }// src/lib/google/auth.ts

import { JWT } from 'google-auth-library';
import { GoogleSheetsService } from './sheets';

export function getGoogleAuthCredentials() {
  try {
    // Ensure all required environment variables are present
    const privateKey = process.env.GOOGLE_SHEETS_PRIVATE_KEY;
    const clientEmail = process.env.GOOGLE_SHEETS_CLIENT_EMAIL;
    
    console.log('Environment variables check:', {
      hasPrivateKey: !!privateKey,
      privateKeyLength: privateKey?.length,
      hasClientEmail: !!clientEmail,
      spreadsheetId: process.env.GOOGLE_SHEETS_SPREADSHEET_ID
    });

    if (!privateKey || !clientEmail) {
      throw new Error('Missing required Google authentication environment variables');
    }

    // Create credentials object
    return {
      private_key: privateKey.replace(/\\n/g, '\n'), // Handle escaped newlines
      client_email: clientEmail
    };
  } catch (error) {
    console.error('Error in getGoogleAuthCredentials:', error);
    throw error;
  }
}

export function createGoogleAuthClient() {
  try {
    const credentials = getGoogleAuthCredentials();
    
    console.log('Creating JWT client with scopes');
    
    return new JWT({
      email: credentials.client_email,
      key: credentials.private_key,
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });
  } catch (error) {
    console.error('Error in createGoogleAuthClient:', error);
    throw error;
  }
}

// Helper to initialize sheets service with authentication
export async function initializeGoogleSheets() {
  try {
    console.log('Starting Google Sheets initialization');
    
    const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
    
    if (!spreadsheetId) {
      throw new Error('Missing Google Sheets spreadsheet ID');
    }

    const credentials = getGoogleAuthCredentials();
    console.log('Got credentials, creating service');
    
    const sheetsService = new GoogleSheetsService(credentials, spreadsheetId);
    
    console.log('Testing connection with getOffices');
    // Test the connection
    await sheetsService.getOffices();
    
    console.log('Successfully connected to Google Sheets');
    return sheetsService;
  } catch (error) {
    console.error('Detailed initialization error:', error);
    throw new Error('Google Sheets service initialization failed');
  }
}// src/lib/intakeq/clinician-mapping.ts
import { GoogleSheetsService } from '../google/sheets';

export async function testClinicianMapping(
  sheetsService: GoogleSheetsService,
  practitionerId: string
): Promise<{
  found: boolean;
  practitionerId: string;
  matchedClinician?: {
    clinicianId: string;
    name: string;
    intakeQPractitionerId: string;
  };
  allClinicians: Array<{
    clinicianId: string;
    name: string;
    intakeQPractitionerId: string;
  }>;
}> {
  // Get all clinicians
  const clinicians = await sheetsService.getClinicians();
  
  // Log all clinician data for debugging
  console.log('All clinicians:', clinicians.map(c => ({
    clinicianId: c.clinicianId,
    name: c.name,
    intakeQId: c.intakeQPractitionerId
  })));

  // Find matching clinician
  const matchedClinician = clinicians.find(
    c => c.intakeQPractitionerId === practitionerId
  );

  // Return test results
  return {
    found: !!matchedClinician,
    practitionerId,
    matchedClinician: matchedClinician ? {
      clinicianId: matchedClinician.clinicianId,
      name: matchedClinician.name,
      intakeQPractitionerId: matchedClinician.intakeQPractitionerId
    } : undefined,
    allClinicians: clinicians.map(c => ({
      clinicianId: c.clinicianId,
      name: c.name,
      intakeQPractitionerId: c.intakeQPractitionerId
    }))
  };
}// src/lib/intakeq/appointment-sync.ts

import type { 
  IntakeQAppointment, 
  IntakeQWebhookPayload,
  WebhookResponse 
} from '@/types/webhooks';
import type { GoogleSheetsService } from '@/lib/google/sheets';
import type { EmailService } from '@/lib/email/service';
import type { IntakeQService } from './service';
import type { 
  SchedulingRequest,
  AppointmentRecord,
  SessionType,
  AlertSeverity
} from '@/types/scheduling';
import type { 
  ValidationResponse, 
  AppointmentConflict,
  ApiResponse
} from '@/types/api';
import type { ClientPreference } from '@/types/sheets';
import { AuditEventType } from '@/lib/google/sheets';
import { OfficeAssignmentService } from '../scheduling/office-assignment';
import { EmailTemplates } from '../email/templates';
import { RecipientManagementService } from '@/lib/email/recipients';
import { 
  transformIntakeQAppointment, 
  determineSessionType,
  EmailPriority
} from '../transformations/appointment-types';

export class AppointmentSyncHandler {
  private readonly recipientService: RecipientManagementService;

  constructor(
    private readonly sheetsService: GoogleSheetsService,
    private readonly intakeQService: IntakeQService,
    private readonly emailService: EmailService
  ) {
    this.recipientService = new RecipientManagementService(sheetsService);
  }

  /**
   * Process appointment webhook events
   */
  async processAppointmentEvent(
    payload: IntakeQWebhookPayload
  ): Promise<WebhookResponse> {
    if (!payload.Appointment) {
      return { 
        success: false, 
        error: 'Missing appointment data' 
      };
    }

    try {
      // Log webhook receipt
      await this.sheetsService.addAuditLog({
        timestamp: new Date().toISOString(),
        eventType: AuditEventType.WEBHOOK_RECEIVED,
        description: `Received ${payload.Type} webhook`,
        user: 'INTAKEQ_WEBHOOK',
        systemNotes: JSON.stringify({
          appointmentId: payload.Appointment.Id,
          type: payload.Type,
          clientId: payload.ClientId
        })
      });

      switch (payload.Type) {
        case 'AppointmentCreated':
        case 'Appointment Created':
          if (payload.Appointment.RecurrencePattern) {
            return await this.handleRecurringAppointment(
              payload.Appointment,
              payload.Appointment.RecurrencePattern
            );
          }
          return await this.handleNewAppointment(payload.Appointment);
        
        case 'AppointmentUpdated':
        case 'Appointment Updated':
        case 'AppointmentRescheduled':
        case 'Appointment Rescheduled':
          return await this.handleAppointmentUpdate(payload.Appointment);
          
        case 'AppointmentCancelled':
        case 'Appointment Cancelled':
          return await this.handleAppointmentCancellation(payload.Appointment);
          
        default:
          return {
            success: false,
            error: `Unsupported event type: ${payload.Type}`
          };
      }
    } catch (error) {
      console.error('Appointment processing error:', error);
      
      // Log the error
      await this.sheetsService.addAuditLog({
        timestamp: new Date().toISOString(),
        eventType: AuditEventType.SYSTEM_ERROR,
        description: `Error processing appointment ${payload.Appointment.Id}`,
        user: 'SYSTEM',
        systemNotes: error instanceof Error ? error.message : 'Unknown error'
      });

      return {
        success: false,
        error: 'Appointment processing failed'
      };
    }
  }

  private async handleNewAppointment(
    appointment: IntakeQAppointment
  ): Promise<WebhookResponse> {
    try {
      // Convert to scheduling request format
      const request = await this.convertToSchedulingRequest(appointment);
      
      // Validate scheduling
      const validationResult = await this.validateScheduleInRealTime(request);
      if (!validationResult.isValid) {
        return {
          success: false,
          error: `Scheduling validation failed: ${validationResult.conflicts.map(c => c.description).join(', ')}`,
          details: {
            appointmentId: appointment.Id,
            action: 'validation-failed',
            conflicts: validationResult.conflicts
          }
        };
      }

      // Find optimal office
      const [offices, rules, clinicians] = await Promise.all([
        this.sheetsService.getOffices(),
        this.sheetsService.getAssignmentRules(),
        this.sheetsService.getClinicians()
      ]);

      const clientPreference = await this.getClientPreference(appointment.ClientId.toString());
      
      const assignmentService = new OfficeAssignmentService(
        offices,
        rules,
        clinicians,
        clientPreference
      );

      const assignmentResult = await assignmentService.findOptimalOffice(request);
      
      if (!assignmentResult.success) {
        throw new Error(assignmentResult.error || 'Failed to find suitable office');
      }

      // Log the assignment
      await this.sheetsService.addAuditLog({
        timestamp: new Date().toISOString(),
        eventType: AuditEventType.APPOINTMENT_CREATED,
        description: `Assigned office ${assignmentResult.officeId} for appointment ${appointment.Id}`,
        user: 'SYSTEM',
        systemNotes: JSON.stringify({
          appointmentId: appointment.Id,
          officeId: assignmentResult.officeId,
          clientId: appointment.ClientId
        })
      });

      // Send notifications
      await this.sendNotifications({
        type: 'new',
        appointment,
        officeId: assignmentResult.officeId!
      });

      return {
        success: true,
        details: {
          appointmentId: appointment.Id,
          officeId: assignmentResult.officeId,
          action: 'created'
        }
      };
    } catch (error) {
      console.error('Error handling new appointment:', error);
      throw error;
    }
  }

  private async handleAppointmentUpdate(
    appointment: IntakeQAppointment
  ): Promise<WebhookResponse> {
    try {
      const request = await this.convertToSchedulingRequest(appointment);
      
      // Validate scheduling
      const validationResult = await this.validateScheduleInRealTime(request);
      if (!validationResult.isValid) {
        return {
          success: false,
          error: `Scheduling validation failed: ${validationResult.conflicts.map(c => c.description).join(', ')}`,
          details: {
            appointmentId: appointment.Id,
            action: 'validation-failed',
            conflicts: validationResult.conflicts
          }
        };
      }

      // Find optimal office for updated appointment
      const [offices, rules, clinicians] = await Promise.all([
        this.sheetsService.getOffices(),
        this.sheetsService.getAssignmentRules(),
        this.sheetsService.getClinicians()
      ]);

      const clientPreference = await this.getClientPreference(appointment.ClientId.toString());
      
      const assignmentService = new OfficeAssignmentService(
        offices,
        rules,
        clinicians,
        clientPreference
      );

      const assignmentResult = await assignmentService.findOptimalOffice(request);
      
      if (!assignmentResult.success) {
        throw new Error(assignmentResult.error || 'Failed to find suitable office');
      }

      // Log the update
      await this.sheetsService.addAuditLog({
        timestamp: new Date().toISOString(),
        eventType: AuditEventType.APPOINTMENT_UPDATED,
        description: `Updated office assignment for appointment ${appointment.Id}`,
        user: 'SYSTEM',
        newValue: JSON.stringify({
          appointmentId: appointment.Id,
          officeId: assignmentResult.officeId,
          clientId: appointment.ClientId
        })
      });

      // Send notifications
      await this.sendNotifications({
        type: 'update',
        appointment,
        officeId: assignmentResult.officeId!
      });

      return {
        success: true,
        details: {
          appointmentId: appointment.Id,
          officeId: assignmentResult.officeId,
          action: 'updated'
        }
      };
    } catch (error) {
      console.error('Error handling appointment update:', error);
      throw error;
    }
  }

  private async handleAppointmentCancellation(
    appointment: IntakeQAppointment
  ): Promise<WebhookResponse> {
    try {
      // Log cancellation
      await this.sheetsService.addAuditLog({
        timestamp: new Date().toISOString(),
        eventType: AuditEventType.APPOINTMENT_CANCELLED,
        description: `Cancelled appointment ${appointment.Id}`,
        user: 'SYSTEM',
        systemNotes: JSON.stringify({
          appointmentId: appointment.Id,
          clientId: appointment.ClientId,
          reason: appointment.CancellationReason || 'No reason provided'
        })
      });

      // Send notifications
      await this.sendNotifications({
        type: 'cancellation',
        appointment
      });

      return {
        success: true,
        details: {
          appointmentId: appointment.Id,
          action: 'cancelled'
        }
      };
    } catch (error) {
      console.error('Error handling appointment cancellation:', error);
      throw error;
    }
  }

  private async handleRecurringAppointment(
    appointment: IntakeQAppointment,
    recurrencePattern: {
      frequency: 'weekly' | 'biweekly' | 'monthly';
      occurrences: number;
      endDate?: string;
    }
  ): Promise<WebhookResponse> {
    try {
      let currentDate = new Date(appointment.StartDateIso);
      const endDate = recurrencePattern.endDate 
        ? new Date(recurrencePattern.endDate)
        : null;
      
      let occurrenceCount = 0;
      const results: WebhookResponse[] = [];
      
      while (
        occurrenceCount < recurrencePattern.occurrences && 
        (!endDate || currentDate <= endDate)
      ) {
        // Create appointment instance
        const instanceDate = new Date(currentDate);
        const appointmentInstance = {
          ...appointment,
          Id: `${appointment.Id}-${occurrenceCount + 1}`,
          StartDateIso: instanceDate.toISOString(),
          EndDateIso: new Date(
            instanceDate.getTime() + (appointment.Duration * 60000)
          ).toISOString()
        };

        // Process individual instance
        const result = await this.handleNewAppointment(appointmentInstance);
        results.push(result);

        if (!result.success) {
          break;
        }

        // Advance to next occurrence
        switch (recurrencePattern.frequency) {
          case 'weekly':
            currentDate.setDate(currentDate.getDate() + 7);
            break;
          case 'biweekly':
            currentDate.setDate(currentDate.getDate() + 14);
            break;
          case 'monthly':
            currentDate.setMonth(currentDate.getMonth() + 1);
            break;
        }

        occurrenceCount++;
      }

      const failedResults = results.filter(r => !r.success);
      
      if (failedResults.length > 0) {
        return {
          success: false,
          error: 'Some recurring appointments failed to schedule',
          details: {
            appointmentId: appointment.Id,
            action: 'recurring-partial',
            successful: results.length - failedResults.length,
            failed: failedResults.length,
            failures: failedResults
          }
        };
      }

      return {
        success: true,
        details: {
          appointmentId: appointment.Id,
          action: 'recurring-created',
          occurrences: results.length
        }
      };
    } catch (error) {
      console.error('Error handling recurring appointment:', error);
      throw error;
    }
  }

  // Part of appointment-sync.ts

// Part of appointment-sync.ts

private async sendNotifications(options: {
  type: 'new' | 'update' | 'cancellation';
  appointment: IntakeQAppointment;
  officeId?: string;
}): Promise<void> {
  const { type, appointment, officeId } = options;

  // Get recipients based on notification type
  const recipients = await this.emailService.getClinicianRecipients();

  // Transform the appointment
  const transformedAppointment = transformIntakeQAppointment(appointment);

  // Create appropriate template
  const template = EmailTemplates.dailySchedule({
    date: new Date(appointment.StartDateIso).toISOString().split('T')[0],
    appointments: [transformedAppointment],
    conflicts: [],
    officeUtilization: new Map([
      [officeId || '', {
        totalSlots: 8, // Default to 8 hour day
        bookedSlots: 1,
        specialNotes: []
      }]
    ]),
    alerts: [{
      type: 'appointment',
      message: `${type} appointment: ${appointment.ClientName}`,
      severity: type === 'new' ? 'low' : 'high'
    }]
  });
}

  public async validateScheduleInRealTime(
    request: SchedulingRequest
  ): Promise<ValidationResponse> {
    try {
      // Get existing appointments for the date from IntakeQ
      const requestDate = new Date(request.dateTime);
      const startOfDay = new Date(requestDate);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(requestDate);
      endOfDay.setHours(23, 59, 59, 999);

      const existingAppointments = await this.intakeQService.getAppointments(
        startOfDay.toISOString(),
        endOfDay.toISOString()
      );

      const conflicts: AppointmentConflict[] = [];

      // Check clinician availability
      const clinicianBookings = existingAppointments.filter(
        booking => booking.PractitionerId === request.clinicianId
      );

      const requestStart = new Date(request.dateTime);
      const requestEnd = new Date(
        requestStart.getTime() + (request.duration * 60000)
      );

      // Check for conflicts
      for (const booking of clinicianBookings) {
        const bookingStart = new Date(booking.StartDateIso);
        const bookingEnd = new Date(booking.EndDateIso);

        if (requestStart < bookingEnd && requestEnd > bookingStart) {
          conflicts.push({
            type: 'double-booking',
            description: 'Clinician is already booked during this time',
            severity: 'high',
            appointmentIds: [booking.Id]
          });
        }
      }

      return {
        isValid: conflicts.length === 0,
        conflicts
      };
    } catch (error) {
      console.error('Validation error:', error);
      throw error;
    }
  }

  private async getClientPreference(
    clientId: string
  ): Promise<ClientPreference | undefined> {
    const preferences = await this.sheetsService.getClientPreferences();
    return preferences.find(pref => pref.clientId === clientId);
  }

  private async convertToSchedulingRequest(
    appointment: IntakeQAppointment
  ): Promise<SchedulingRequest> {
    try {
      // Find clinician by IntakeQ ID
      const clinicians = await this.sheetsService.getClinicians();
      const clinician = clinicians.find(c => 
        c.intakeQPractitionerId === appointment.PractitionerId
      );

      if (!clinician) {
        throw new Error(`No clinician found for IntakeQ ID: ${appointment.PractitionerId}`);
      }

      // Get client preferences to determine requirements
      const clientPrefs = await this.getClientPreference(appointment.ClientId.toString());
      
      // Set base requirements from client preferences
      const mobilityNeeds = clientPrefs?.mobilityNeeds || [];
      const sensoryPrefs = clientPrefs?.sensoryPreferences || [];
      const physicalNeeds = clientPrefs?.physicalNeeds || [];

      const requirements = {
        accessibility: Array.isArray(mobilityNeeds) && mobilityNeeds.length > 0,
        specialFeatures: [
          ...(Array.isArray(sensoryPrefs) ? sensoryPrefs : []),
          ...(Array.isArray(physicalNeeds) ? physicalNeeds : [])
        ],
        roomPreference: clientPrefs?.assignedOffice || undefined
      };

      return {
        clientId: appointment.ClientId.toString(),
        clinicianId: clinician.clinicianId,
        dateTime: appointment.StartDateIso,
        duration: appointment.Duration,
        sessionType: this.determineSessionType(appointment),
        requirements
      };
    } catch (error) {
      // Log conversion error
      await this.sheetsService.addAuditLog({
        timestamp: new Date().toISOString(),
        eventType: AuditEventType.SYSTEM_ERROR,
        description: `Error converting IntakeQ appointment ${appointment.Id}`,
        user: 'SYSTEM',
        systemNotes: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  private determineSessionType(
    appointment: IntakeQAppointment
  ): 'in-person' | 'telehealth' | 'group' | 'family' {
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
  
    // Check service metadata if available
    if (appointment.ServiceId) {
      // Store common service IDs for quick lookup
      const TELEHEALTH_SERVICES = ['64a319db9173cb32157ea065', '64a319db9173cb32157ea066'];
      const GROUP_SERVICES = ['64a319db9173cb32157ea067'];
      const FAMILY_SERVICES = ['64a319db9173cb32157ea068'];
  
      if (TELEHEALTH_SERVICES.includes(appointment.ServiceId)) {
        return 'telehealth';
      }
      if (GROUP_SERVICES.includes(appointment.ServiceId)) {
        return 'group';
      }
      if (FAMILY_SERVICES.includes(appointment.ServiceId)) {
        return 'family';
      }
    }
  
    // Default to in-person if no other matches
    return 'in-person';
  }
}// src/lib/intakeq/webhook-handler.ts

import type { IntakeQWebhookPayload, WebhookEventType } from '@/types/webhooks';
import type { GoogleSheetsService } from '@/lib/google/sheets';
import { AppointmentSyncHandler } from './appointment-sync';
import { AuditEventType } from '@/lib/google/sheets';

interface WebhookProcessingResult {
  success: boolean;
  error?: string;
  retryable?: boolean;
  details?: any;
}

export class EnhancedWebhookHandler {
  private readonly MAX_RETRIES = 3;
  private readonly RETRY_DELAYS = [1000, 5000, 15000]; // Delays in milliseconds

  constructor(
    private readonly sheetsService: GoogleSheetsService,
    private readonly appointmentSync: AppointmentSyncHandler
  ) {}

  /**
   * Get event type from payload, handling both field names
   */
  private getEventType(payload: Partial<IntakeQWebhookPayload>): WebhookEventType | undefined {
    // Use EventType if available, fall back to Type
    return payload.EventType || payload.Type;
  }

  /**
   * Process incoming webhook with validation and retries
   */
  async processWebhook(
    payload: unknown,
    signature?: string
  ): Promise<WebhookProcessingResult> {
    try {
      // Validate webhook payload
      const validationResult = this.validateWebhook(payload, signature);
      if (!validationResult.isValid) {
        await this.logWebhookError('VALIDATION_ERROR', validationResult.error || 'Unknown validation error', payload);
        return {
          success: false,
          error: validationResult.error,
          retryable: false
        };
      }

      const typedPayload = payload as IntakeQWebhookPayload;

      // Log webhook receipt
      await this.sheetsService.addAuditLog({
        timestamp: new Date().toISOString(),
        eventType: AuditEventType.WEBHOOK_RECEIVED,
        description: `Received ${typedPayload.Type} webhook`,
        user: 'INTAKEQ_WEBHOOK',
        systemNotes: JSON.stringify({
          type: typedPayload.Type,
          clientId: typedPayload.ClientId
        })
      });

      // Process with retry logic
      return await this.processWithRetry(typedPayload);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      await this.logWebhookError('PROCESSING_ERROR', errorMessage, payload);
      
      return {
        success: false,
        error: errorMessage,
        retryable: this.isRetryableError(error)
      };
    }
  }

  /**
   * Validate webhook payload and signature
   */
  private validateWebhook(
    payload: unknown,
    signature?: string
  ): { isValid: boolean; error?: string } {
    // Basic payload validation
    if (!payload || typeof payload !== 'object') {
      return { isValid: false, error: 'Invalid payload format' };
    }

    const typedPayload = payload as Partial<IntakeQWebhookPayload>;

    // Required fields validation - check both Type and EventType
    const eventType = this.getEventType(typedPayload);
    if (!typedPayload.Type && !typedPayload.EventType) {
      return { isValid: false, error: 'Missing event type field' };
    }
    if (!typedPayload.ClientId) {
      return { isValid: false, error: 'Missing ClientId field' };
    }

    // Type-specific validation
    if (typedPayload.Type === 'Appointment Created' || 
        typedPayload.Type === 'Appointment Updated') {
      if (!typedPayload.Appointment) {
        return { isValid: false, error: 'Missing appointment data' };
      }

      // Validate appointment fields
      const appointment = typedPayload.Appointment;
      if (!appointment.Id || !appointment.StartDateIso || !appointment.EndDateIso) {
        return { isValid: false, error: 'Invalid appointment data' };
      }
    }

    // Signature validation if provided
    if (signature && !this.validateSignature(payload, signature)) {
      return { isValid: false, error: 'Invalid signature' };
    }

    return { isValid: true };
  }

  /**
   * Process webhook with retry logic
   */
  private async processWithRetry(
    payload: IntakeQWebhookPayload,
    attempt: number = 0
  ): Promise<WebhookProcessingResult> {
    try {
      let result: WebhookProcessingResult;

      const eventType = this.getEventType(payload);
switch (eventType) {
  case 'Appointment Created':
  case 'Appointment Updated':
  case 'AppointmentCreated':
  case 'AppointmentUpdated':
    result = await this.appointmentSync.processAppointmentEvent(payload);
    break;

        case 'Intake Submitted':
          // Handle intake form submission
          result = await this.handleIntakeSubmission(payload);
          break;

        default:
          return {
            success: false,
            error: `Unsupported webhook type: ${payload.Type}`,
            retryable: false
          };
      }

      if (!result.success && result.retryable && attempt < this.MAX_RETRIES) {
        // Log retry attempt
        await this.logRetryAttempt(payload, attempt);
        
        // Wait for delay
        await new Promise(resolve => setTimeout(resolve, this.RETRY_DELAYS[attempt]));
        
        // Retry processing
        return this.processWithRetry(payload, attempt + 1);
      }

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      // Log error
      await this.logWebhookError(
        'RETRY_ERROR',
        `Error on attempt ${attempt + 1}: ${errorMessage}`,
        payload
      );

      // Determine if another retry should be attempted
      if (this.isRetryableError(error) && attempt < this.MAX_RETRIES) {
        await new Promise(resolve => setTimeout(resolve, this.RETRY_DELAYS[attempt]));
        return this.processWithRetry(payload, attempt + 1);
      }

      return {
        success: false,
        error: errorMessage,
        retryable: false
      };
    }
  }

  /**
   * Handle intake form submission
   */
  private async handleIntakeSubmission(
    payload: IntakeQWebhookPayload
  ): Promise<WebhookProcessingResult> {
    try {
      // Process form responses
      if (!payload.formId || !payload.responses) {
        return {
          success: false,
          error: 'Missing form data',
          retryable: false
        };
      }

      // Log form submission
      await this.sheetsService.addAuditLog({
        timestamp: new Date().toISOString(),
        eventType: AuditEventType.WEBHOOK_RECEIVED,
        description: `Processing intake form ${payload.formId}`,
        user: 'INTAKEQ_WEBHOOK',
        systemNotes: JSON.stringify({
          formId: payload.formId,
          clientId: payload.ClientId
        })
      });

      // Process form data
      // Additional form processing logic would go here

      return {
        success: true,
        details: {
          formId: payload.formId,
          clientId: payload.ClientId
        }
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      await this.logWebhookError('FORM_PROCESSING_ERROR', errorMessage, payload);
      
      return {
        success: false,
        error: errorMessage,
        retryable: this.isRetryableError(error)
      };
    }
  }

  /**
   * Determine if an error is retryable
   */
  private isRetryableError(error: unknown): boolean {
    if (error instanceof Error) {
      // Network errors are typically retryable
      if (error.message.includes('network') || error.message.includes('timeout')) {
        return true;
      }

      // API rate limiting errors are retryable
      if (error.message.includes('rate limit') || error.message.includes('429')) {
        return true;
      }

      // Temporary service errors are retryable
      if (error.message.includes('503') || error.message.includes('temporary')) {
        return true;
      }
    }

    return false;
  }

  /**
   * Validate webhook signature
   */
  private validateSignature(payload: unknown, signature: string): boolean {
    // Implement signature validation logic here
    // This would typically involve HMAC verification
    return true; // Placeholder
  }

  /**
   * Log webhook error
   */
  private async logWebhookError(
    errorType: string,
    message: string,
    payload: unknown
  ): Promise<void> {
    await this.sheetsService.addAuditLog({
      timestamp: new Date().toISOString(),
      eventType: AuditEventType.SYSTEM_ERROR,
      description: `Webhook ${errorType}: ${message}`,
      user: 'SYSTEM',
      systemNotes: JSON.stringify({
        errorType,
        payload,
        timestamp: new Date().toISOString()
      })
    });
  }

  /**
   * Log retry attempt
   */
  private async logRetryAttempt(
    payload: IntakeQWebhookPayload,
    attempt: number
  ): Promise<void> {
    await this.sheetsService.addAuditLog({
      timestamp: new Date().toISOString(),
      eventType: AuditEventType.WEBHOOK_RECEIVED,
      description: `Retry attempt ${attempt + 1} for ${payload.Type}`,
      user: 'SYSTEM',
      systemNotes: JSON.stringify({
        attempt: attempt + 1,
        type: payload.Type,
        clientId: payload.ClientId,
        timestamp: new Date().toISOString()
      })
    });
  }
}// src/lib/intakeq/webhook.ts

import type { AuditLogEntry } from '@/types/sheets';
import type { 
  IntakeQWebhookPayload, 
  WebhookEventType,
  WebhookResponse
} from '@/types/webhooks';
import { WebhookError } from '@/types/webhooks';

/**
 * Validate webhook payload
 */
export function validateWebhookPayload(rawPayload: unknown): {
  isValid: boolean;
  error?: string;
  payload?: IntakeQWebhookPayload;
} {
  try {
    if (!rawPayload || typeof rawPayload !== 'object') {
      return {
        isValid: false,
        error: 'Invalid webhook payload structure'
      };
    }

    const payload = rawPayload as IntakeQWebhookPayload;

    // Check required fields
    if (!payload.Type) {
      return {
        isValid: false,
        error: 'Missing required field: Type'
      };
    }

    if (!payload.ClientId) {
      return {
        isValid: false,
        error: 'Missing required field: ClientId'
      };
    }

    // Validate by event type
    switch (payload.Type) {
      case 'Form Submitted':
      case 'Intake Submitted':
        if (!payload.formId) {
          return {
            isValid: false,
            error: 'Missing required field for form submission: formId'
          };
        }
        if (!payload.responses) {
          return {
            isValid: false,
            error: 'Missing required field for form submission: responses'
          };
        }
        break;

      case 'Appointment Created':
      case 'Appointment Updated':
      case 'Appointment Rescheduled':
      case 'Appointment Cancelled':
        if (!payload.Appointment) {
          return {
            isValid: false,
            error: 'Missing required field for appointment event: Appointment'
          };
        }
        if (!payload.Appointment.Id) {
          return {
            isValid: false,
            error: 'Missing required field: Appointment.Id'
          };
        }
        break;

      default:
        return {
          isValid: false,
          error: `Unsupported event type: ${payload.Type}`
        };
    }

    return {
      isValid: true,
      payload
    };
  } catch (error) {
    return {
      isValid: false,
      error: error instanceof Error ? error.message : 'Unknown validation error'
    };
  }
}

/**
 * Create audit log entry for webhook event
 */
export function createWebhookAuditLog(
  event: IntakeQWebhookPayload,
  status: 'received' | 'processed' | 'failed',
  error?: string
): AuditLogEntry {
  const timestamp = new Date().toISOString();
  
  const baseEntry = {
    timestamp,
    user: 'INTAKEQ_WEBHOOK',
    eventType: 'WEBHOOK_RECEIVED',
  };

  switch (status) {
    case 'received':
      return {
        ...baseEntry,
        description: `Received ${event.Type} webhook`,
        systemNotes: JSON.stringify({
          type: event.Type,
          clientId: event.ClientId,
          appointmentId: event.Appointment?.Id
        })
      };

    case 'processed':
      return {
        ...baseEntry,
        eventType: 'WEBHOOK_PROCESSED',
        description: `Successfully processed ${event.Type} webhook`,
        systemNotes: JSON.stringify({
          type: event.Type,
          clientId: event.ClientId,
          appointmentId: event.Appointment?.Id
        })
      };

    case 'failed':
      return {
        ...baseEntry,
        eventType: 'WEBHOOK_FAILED',
        description: `Failed to process ${event.Type} webhook`,
        systemNotes: JSON.stringify({
          type: event.Type,
          clientId: event.ClientId,
          appointmentId: event.Appointment?.Id,
          error
        })
      };

    default:
      throw new Error(`Unsupported audit log status: ${status}`);
  }
}import type { IntakeQWebhookPayload, IntakeQAppointment } from '@/types/webhooks';
import { GoogleSheetsService, AuditEventType } from '@/lib/google/sheets';
import { OfficeAssignmentService } from '@/lib/scheduling/office-assignment';
import type { AppointmentRecord } from '@/types/scheduling';

export class AppointmentHandler {
  constructor(
    private readonly sheetsService: GoogleSheetsService
  ) {}

  // src/lib/intakeq/appointment-handler.ts
async handleAppointment(payload: IntakeQWebhookPayload): Promise<{ success: boolean; error?: string }> {
  try {
    if (!payload.Appointment) {
      throw new Error('No appointment data in payload');
    }

    console.log('Processing appointment:', {
      type: payload.Type || payload.EventType, // Check both Type and EventType
      appointmentId: payload.Appointment.Id,
      clientId: payload.ClientId,
      startDate: payload.Appointment.StartDateIso,
      duration: payload.Appointment.Duration,
      practitionerId: payload.Appointment.PractitionerId
    });

    switch (payload.Type || payload.EventType) { // Check both Type and EventType
      case 'AppointmentCreated':
      case 'Appointment Created':
        return await this.handleNewAppointment(payload.Appointment, payload.ClientId);
      
      case 'AppointmentUpdated':
      case 'Appointment Updated':
      case 'AppointmentRescheduled':
      case 'Appointment Rescheduled':
        return await this.handleAppointmentUpdate(payload.Appointment, payload.ClientId);
      
      case 'AppointmentCancelled':
      case 'Appointment Cancelled':
      case 'AppointmentCanceled':
      case 'Appointment Canceled':
        return await this.handleAppointmentCancellation(payload.Appointment, payload.ClientId);
      
      case 'AppointmentDeleted':
      case 'Appointment Deleted':
        return await this.handleAppointmentDeletion(payload.Appointment, payload.ClientId);
      
      default:
        throw new Error(`Unsupported appointment event type: ${payload.Type || payload.EventType}`);
    }
  } catch (error) {
    console.error('Error handling appointment:', error);
    
    await this.sheetsService.addAuditLog({
      timestamp: new Date().toISOString(),
      eventType: AuditEventType.SYSTEM_ERROR,
      description: `Error processing ${payload.Type || payload.EventType}`,
      user: 'SYSTEM',
      systemNotes: error instanceof Error ? error.message : 'Unknown error'
    });

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    };
  }
}

private async handleNewAppointment(appointment: IntakeQAppointment, clientId: string | number): Promise<{ success: boolean; error?: string }> {
  try {
    // Enhanced logging for appointment data
    console.log('Processing new appointment:', {
      appointmentId: appointment.Id,
      clientId,
      clientName: appointment.ClientName,
      startDate: appointment.StartDateIso,
      practitionerId: appointment.PractitionerId,
      serviceName: appointment.ServiceName
    });

    // 1. Get required data
    const [offices, rules, clinicians] = await Promise.all([
      this.sheetsService.getOffices(),
      this.sheetsService.getAssignmentRules(),
      this.sheetsService.getClinicians()
    ]);

    // Enhanced clinician lookup logging
    console.log('Clinician lookup:', {
      searchingFor: appointment.PractitionerId,
      availableClinicians: clinicians.map(c => ({
        id: c.clinicianId,
        name: c.name,
        intakeQId: c.intakeQPractitionerId
      }))
    });

    // Find matching clinician with exact match
    const matchedClinician = clinicians.find(c => 
      c.intakeQPractitionerId && 
      c.intakeQPractitionerId.trim() === appointment.PractitionerId.trim()
    );

    if (!matchedClinician) {
      const error = `No clinician found matching IntakeQ ID: ${appointment.PractitionerId}`;
      console.error(error, {
        appointmentId: appointment.Id,
        practitionerName: appointment.PractitionerName,
        allClinicianIds: clinicians.map(c => c.intakeQPractitionerId)
      });
      throw new Error(error);
    }

    console.log('Found matching clinician:', {
      clinicianId: matchedClinician.clinicianId,
      name: matchedClinician.name,
      intakeQId: matchedClinician.intakeQPractitionerId
    });

    // 2. Create office assignment service
    const assignmentService = new OfficeAssignmentService(
      offices,
      rules,
      clinicians
    );

    // 3. Convert to scheduling request
    const request = {
      clientId: clientId.toString(),
      clinicianId: matchedClinician.clinicianId,
      dateTime: appointment.StartDateIso,
      duration: appointment.Duration,
      sessionType: this.determineSessionType(appointment.ServiceName),
      requirements: {
        accessibility: false
      }
    };

    // Rest of the function remains the same, but using matchedClinician instead of clinician
      console.log('Created scheduling request:', request);

      // 4. Find optimal office
      const assignmentResult = await assignmentService.findOptimalOffice(request);
      console.log('Office assignment result:', assignmentResult);

      if (!assignmentResult.success) {
        throw new Error(assignmentResult.error || 'Failed to find suitable office');
      }

      // 5. Create appointment record
      const appointmentRecord: AppointmentRecord = {
        appointmentId: appointment.Id,
        clientId: clientId.toString(),
        clientName: appointment.ClientName,  // Add this
        clinicianId: matchedClinician.clinicianId,
        clinicianName: matchedClinician.name,
        officeId: assignmentResult.officeId!,
        sessionType: this.determineSessionType(appointment.ServiceName),
        startTime: appointment.StartDateIso,
        endTime: appointment.EndDateIso,
        status: 'scheduled',
        lastUpdated: new Date().toISOString(),
        source: 'intakeq',
        requirements: {
          accessibility: false,
          specialFeatures: []
        },
        notes: assignmentResult.notes
      };

      console.log('Created appointment record:', appointmentRecord);

      // 6. Store the appointment
      await this.sheetsService.addAppointment(appointmentRecord);

      // 7. Log success
      await this.sheetsService.addAuditLog({
        timestamp: new Date().toISOString(),
        eventType: AuditEventType.APPOINTMENT_CREATED,
        description: `Created appointment ${appointment.Id}`,
        user: 'SYSTEM',
        systemNotes: JSON.stringify({
          appointmentId: appointment.Id,
          officeId: assignmentResult.officeId,
          clientId: clientId
        })
      });

      return { success: true };
    } catch (error) {
      console.error('Error creating appointment:', error);
      throw error;
    }
  }

  private async handleAppointmentUpdate(appointment: IntakeQAppointment, clientId: string | number): Promise<{ success: boolean; error?: string }> {
    try {
      console.log('Handling appointment update:', {
        appointmentId: appointment.Id,
        clientId,
        startDate: appointment.StartDateIso,
        oldTime: null, // Will be populated below
        newTime: appointment.StartDateIso
      });
  
      // Get existing appointment data
      const existingAppointment = await this.sheetsService.getAppointment(appointment.Id);
      if (!existingAppointment) {
        console.log('No existing appointment found, creating new');
        return await this.handleNewAppointment(appointment, clientId);
      }
  
      console.log('Found existing appointment:', {
        old: {
          startTime: existingAppointment.startTime,
          endTime: existingAppointment.endTime,
          officeId: existingAppointment.officeId
        },
        new: {
          startTime: appointment.StartDateIso,
          endTime: appointment.EndDateIso
        }
      });
  
      // 1. Get required data to check for new office assignment
      const [offices, rules, clinicians] = await Promise.all([
        this.sheetsService.getOffices(),
        this.sheetsService.getAssignmentRules(),
        this.sheetsService.getClinicians()
      ]);
  
      // 2. Find matching clinician
      const clinician = clinicians.find(c => c.intakeQPractitionerId === appointment.PractitionerId);
      if (!clinician) {
        throw new Error(`Clinician ${appointment.PractitionerId} not found`);
      }
  
      // 3. Create updated appointment record
      const updatedAppointment: AppointmentRecord = {
        ...existingAppointment,
        startTime: appointment.StartDateIso,
        endTime: appointment.EndDateIso,
        lastUpdated: new Date().toISOString(),
        sessionType: this.determineSessionType(appointment.ServiceName),
        clientName: appointment.ClientName,
        clinicianName: clinician.name
      };
  
      // 4. Update in sheets
      await this.sheetsService.updateAppointment(updatedAppointment);
  
      // 5. Log the update
      await this.sheetsService.addAuditLog({
        timestamp: new Date().toISOString(),
        eventType: AuditEventType.APPOINTMENT_UPDATED,
        description: `Updated appointment ${appointment.Id}`,
        user: 'SYSTEM',
        previousValue: JSON.stringify({
          startTime: existingAppointment.startTime,
          endTime: existingAppointment.endTime
        }),
        newValue: JSON.stringify({
          startTime: appointment.StartDateIso,
          endTime: appointment.EndDateIso
        }),
        systemNotes: `Updated time from ${existingAppointment.startTime} to ${appointment.StartDateIso}`
      });
  
      return { success: true };
    } catch (error) {
      console.error('Error updating appointment:', error);
      throw error;
    }
  }

  private async handleAppointmentCancellation(appointment: IntakeQAppointment, clientId: string | number): Promise<{ success: boolean; error?: string }> {
    try {
      console.log('Handling appointment cancellation:', {
        appointmentId: appointment.Id,
        clientId,
        startDate: appointment.StartDateIso
      });

      await this.sheetsService.updateAppointment({
        appointmentId: appointment.Id,
        clientId: clientId.toString(),
        clientName: appointment.ClientName,  // Add this
        clinicianId: appointment.PractitionerId,
        clinicianName: appointment.PractitionerName,  // Add this
        officeId: '', // Keep existing office
        sessionType: this.determineSessionType(appointment.ServiceName),
        startTime: appointment.StartDateIso,
        endTime: appointment.EndDateIso,
        status: 'cancelled',
        lastUpdated: new Date().toISOString(),
        source: 'intakeq'
      });

      await this.sheetsService.addAuditLog({
        timestamp: new Date().toISOString(),
        eventType: AuditEventType.APPOINTMENT_CANCELLED,
        description: `Cancelled appointment ${appointment.Id}`,
        user: 'SYSTEM',
        systemNotes: JSON.stringify({
          appointmentId: appointment.Id,
          clientId: clientId,
          reason: appointment.CancellationReason
        })
      });

      return { success: true };
    } catch (error) {
      console.error('Error cancelling appointment:', error);
      throw error;
    }
  }

  private async handleAppointmentDeletion(appointment: IntakeQAppointment, clientId: number): Promise<{ success: boolean; error?: string; appointmentId?: string; action?: string }> {
    try {
      // Get existing appointment
      const appointmentDate = new Date(appointment.StartDateIso).toISOString().split('T')[0];
      const existingAppointments = await this.sheetsService.getAppointments(
        `${appointmentDate}T00:00:00Z`,
        `${appointmentDate}T23:59:59Z`
      );

      const existingAppointment = existingAppointments.find(
        appt => appt.appointmentId === appointment.Id
      );

      if (!existingAppointment) {
        return {
          success: false,
          error: 'Appointment not found',
          appointmentId: appointment.Id,
          action: 'deletion-failed'
        };
      }

      // Delete appointment from sheets
      await this.sheetsService.deleteAppointment(existingAppointment.appointmentId);

      // Log deletion
      await this.sheetsService.addAuditLog({
        timestamp: new Date().toISOString(),
        eventType: AuditEventType.APPOINTMENT_DELETED,
        description: `Deleted appointment ${appointment.Id}`,
        user: 'SYSTEM',
        previousValue: JSON.stringify(existingAppointment)
      });

      return {
        success: true,
        appointmentId: appointment.Id,
        action: 'deleted'
      };
    } catch (error) {
      console.error('Error handling appointment deletion:', error);
      throw error;
    }
  }

  private determineSessionType(serviceName: string): 'in-person' | 'telehealth' | 'group' | 'family' {
    const name = serviceName.toLowerCase();
    if (name.includes('telehealth')) return 'telehealth';
    if (name.includes('group')) return 'group';
    if (name.includes('family') || name.includes('relationship')) return 'family';
    return 'in-person';
  }
}// src/lib/intakeq/service.ts

import type { IntakeQAppointment } from '@/types/webhooks';
import { GoogleSheetsService, AuditEventType } from '@/lib/google/sheets';
import crypto from 'crypto';

export class IntakeQService {
  private readonly baseUrl: string;
  private readonly headers: HeadersInit;
  private readonly MAX_RETRIES = 3;
  private readonly RETRY_DELAY = 1000; // 1 second base delay

  constructor(
    private readonly apiKey: string,
    private readonly sheetsService: GoogleSheetsService,
    baseUrl: string = 'https://intakeq.com/api/v1',
    private readonly useMockData: boolean = false
  ) {
    this.baseUrl = baseUrl;
    this.headers = {
      'X-Auth-Key': apiKey,
      'Accept': 'application/json'
    };
  }

  async getAppointments(startDate: string, endDate: string): Promise<IntakeQAppointment[]> {
    try {
      console.log('Fetching IntakeQ appointments:', { startDate, endDate });

      // Convert dates to EST and set proper day boundaries
      const requestedStart = new Date(startDate);
      const requestedEnd = new Date(endDate);

      // Ensure we're working with EST dates
      const startEST = new Date(requestedStart.toLocaleString('en-US', { timeZone: 'America/New_York' }));
      const endEST = new Date(requestedEnd.toLocaleString('en-US', { timeZone: 'America/New_York' }));
      startEST.setHours(0, 0, 0, 0);
      endEST.setHours(23, 59, 59, 999);

      console.log('Date ranges (EST):', {
        start: startEST.toLocaleString('en-US', { timeZone: 'America/New_York' }),
        end: endEST.toLocaleString('en-US', { timeZone: 'America/New_York' })
      });

      const params = new URLSearchParams({
        StartDate: startEST.getTime().toString(),
        EndDate: endEST.getTime().toString(),
        Status: 'Confirmed,WaitingConfirmation,Pending',
        dateField: 'StartDateIso'
      });

      const url = `${this.baseUrl}/appointments?${params}`;

      console.log('IntakeQ Request:', {
        endpoint: '/appointments',
        params: Object.fromEntries(params),
        requestRange: {
          start: startEST.toLocaleString('en-US', { timeZone: 'America/New_York' }),
          end: endEST.toLocaleString('en-US', { timeZone: 'America/New_York' })
        }
      });

      let attempt = 0;
      let response;
      let lastError;

      while (attempt < this.MAX_RETRIES) {
        try {
          response = await fetch(url, {
            method: 'GET',
            headers: this.headers
          });

          if (response.ok) break;

          const errorText = await response.text();
          lastError = `HTTP ${response.status}: ${errorText}`;
          
          console.log(`Attempt ${attempt + 1} failed:`, {
            status: response.status,
            error: lastError
          });

          attempt++;
          if (attempt < this.MAX_RETRIES) {
            const delay = this.RETRY_DELAY * Math.pow(2, attempt - 1);
            await new Promise(resolve => setTimeout(resolve, delay));
          }
        } catch (error) {
          lastError = error instanceof Error ? error.message : 'Unknown error';
          console.error(`Attempt ${attempt + 1} error:`, lastError);
          
          attempt++;
          if (attempt < this.MAX_RETRIES) {
            const delay = this.RETRY_DELAY * Math.pow(2, attempt - 1);
            await new Promise(resolve => setTimeout(resolve, delay));
          }
        }
      }

      if (!response || !response.ok) {
        throw new Error(`IntakeQ API error after ${this.MAX_RETRIES} attempts: ${lastError}`);
      }

      const text = await response.text();
      console.log('Raw IntakeQ Response:', text.substring(0, 500) + '...');

      const appointments = JSON.parse(text);

      // Filter appointments to match requested date in EST
      const filteredAppointments = appointments.filter((appt: IntakeQAppointment) => {
        const apptDate = new Date(appt.StartDateIso);
        const apptEST = new Date(apptDate.toLocaleString('en-US', { timeZone: 'America/New_York' }));
        apptEST.setHours(0, 0, 0, 0);  // Compare dates only

        const targetEST = new Date(requestedStart.toLocaleString('en-US', { timeZone: 'America/New_York' }));
        targetEST.setHours(0, 0, 0, 0);  // Compare dates only

        console.log('Appointment comparison:', {
          id: appt.Id,
          client: appt.ClientName,
          apptDate: apptEST.toLocaleString('en-US', { timeZone: 'America/New_York' }),
          targetDate: targetEST.toLocaleString('en-US', { timeZone: 'America/New_York' }),
          matches: apptEST.getTime() === targetEST.getTime()
        });

        return apptEST.getTime() === targetEST.getTime();
      });

      console.log('IntakeQ Response:', {
        status: response.status,
        totalReturned: appointments.length,
        matchingDateRange: filteredAppointments.length,
        sampleAppointment: filteredAppointments[0] ? {
          id: filteredAppointments[0].Id,
          name: filteredAppointments[0].ClientName,
          date: filteredAppointments[0].StartDateLocalFormatted,
          status: filteredAppointments[0].Status
        } : null
      });

      return filteredAppointments;
    } catch (error) {
      console.error('IntakeQ API Error:', error instanceof Error ? error.message : 'Unknown error');
      
      await this.sheetsService.addAuditLog({
        timestamp: new Date().toISOString(),
        eventType: AuditEventType.SYSTEM_ERROR,
        description: 'IntakeQ API error',
        user: 'SYSTEM',
        systemNotes: error instanceof Error ? error.message : 'Unknown error'
      });
      
      throw error;
    }
  }

  async validateWebhookSignature(payload: string, signature: string): Promise<boolean> {
    try {
      const secret = process.env.INTAKEQ_WEBHOOK_SECRET;
      if (!secret) {
        console.error('Missing INTAKEQ_WEBHOOK_SECRET environment variable');
        return false;
      }

      // Remove any quotes from the secret
      const cleanSecret = secret.replace(/['"]/g, '');

      // Create HMAC
      const hmac = crypto.createHmac('sha256', cleanSecret);
      hmac.update(payload);
      const calculatedSignature = hmac.digest('hex');

      console.log('Webhook Signature Validation:', {
        signatureMatches: calculatedSignature === signature,
        calculatedLength: calculatedSignature.length,
        providedLength: signature.length,
        payloadLength: payload.length,
      });

      return calculatedSignature === signature;
    } catch (error) {
      console.error('Webhook signature validation error:', error);
      return false;
    }
  }

  async testConnection(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/practitioners`, {
        headers: this.headers
      });

      console.log('IntakeQ Connection Test:', {
        status: response.status,
        ok: response.ok
      });

      return response.ok;
    } catch (error) {
      console.error('IntakeQ connection test failed:', error instanceof Error ? error.message : 'Unknown error');
      return false;
    }
  }
}// src/lib/intakeq/accessibility-form.ts

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
}// src/lib/email/templates.ts

import type { DailyScheduleSummary } from '@/types/scheduling';
import { toEST, getDisplayDate, formatDateRange } from '../util/date-helpers';

export interface EmailTemplate {
  subject: string;
  html: string;
  text: string;
}

export class EmailTemplates {
  static dailySchedule(summary: DailyScheduleSummary): EmailTemplate {
    const displayDate = new Date(summary.date).toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      timeZone: 'America/New_York'
    });
    const hasHighPriorityAlerts = summary.alerts.some(a => a.severity === 'high');

    return {
      subject: this.formatSubject(displayDate, summary),
      html: this.formatHtml(displayDate, summary),
      text: this.formatText(displayDate, summary)
    };
  }

  private static formatSubject(displayDate: string, summary: DailyScheduleSummary): string {
    const hasHighPriorityAlerts = summary.alerts.some(a => a.severity === 'high');
    const hasConflicts = summary.conflicts.length > 0;

    let subject = `Daily Schedule - ${displayDate}`;
    if (hasHighPriorityAlerts) {
      subject = `⚠️ ${subject} - HIGH PRIORITY ALERTS`;
    } else if (hasConflicts) {
      subject = `⚠️ ${subject} - Conflicts Detected`;
    }
    return subject;
  }

  private static formatHtml(displayDate: string, summary: DailyScheduleSummary): string {
    return `
      <div style="font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; line-height: 1.5;">
        <h1 style="color: #1e40af; margin-bottom: 1.5em;">Daily Schedule - ${displayDate}</h1>
        
        ${this.formatAlertsHtml(summary.alerts)}
        ${this.formatConflictsHtml(summary.conflicts)}
        
        <div style="margin: 2em 0;">
          <h2 style="color: #1e40af; margin-bottom: 1em;">Appointments</h2>
          ${summary.appointments.length === 0 ? 
            `<p style="color: #666;">No appointments scheduled for ${displayDate}.</p>` :
            this.formatAppointmentsTable(summary.appointments)
          }
        </div>

        <div style="margin: 2em 0;">
          <h2 style="color: #1e40af; margin-bottom: 1em;">Office Utilization</h2>
          ${this.formatOfficeUtilization(summary.officeUtilization)}
        </div>

        <div style="color: #6b7280; font-size: 12px; margin-top: 3em; border-top: 1px solid #e5e7eb; padding-top: 1em;">
          Generated ${new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })}
        </div>
      </div>
    `;
  }

  private static formatText(displayDate: string, summary: DailyScheduleSummary): string {
    const lines: string[] = [
      `Daily Schedule - ${displayDate}`,
      '',
    ];

    // Add alerts
    if (summary.alerts.length > 0) {
      lines.push('ALERTS:');
      summary.alerts.forEach(alert => {
        lines.push(`[${alert.severity.toUpperCase()}] ${alert.type}: ${alert.message}`);
      });
      lines.push('');
    }

    // Add conflicts
    if (summary.conflicts.length > 0) {
      lines.push('CONFLICTS:');
      summary.conflicts.forEach(conflict => {
        lines.push(`[${conflict.severity.toUpperCase()}] ${conflict.type}: ${conflict.description}`);
      });
      lines.push('');
    }

    // Add appointments
    lines.push('APPOINTMENTS:');
    if (summary.appointments.length === 0) {
      lines.push('No appointments scheduled for this day.');
    } else {
      summary.appointments
        .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
        .forEach(appt => {
          lines.push(
            `${formatDateRange(appt.startTime, appt.endTime)} - ` +
            `${appt.clientName} with ${appt.clinicianName} ` +
            `(${appt.sessionType}${appt.officeId ? ` in ${appt.officeId}` : ''})`
          );
        });
    }
    lines.push('');

    // Add office utilization
    lines.push('OFFICE UTILIZATION:');
    Array.from(summary.officeUtilization.entries()).forEach(([officeId, data]) => {
      const utilization = Math.round((data.bookedSlots / data.totalSlots) * 100);
      lines.push(
        `${officeId}: ${utilization}% ` +
        `${data.specialNotes?.length ? `(${data.specialNotes.join(', ')})` : ''}`
      );
    });

    lines.push('');
    lines.push(`Generated ${new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })}`);

    return lines.join('\n');
  }

  private static formatAppointmentsTable(appointments: DailyScheduleSummary['appointments'], displayDate?: string): string {
    return `
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 2em;">
        <thead>
          <tr style="background-color: #dbeafe;">
            <th style="padding: 12px; text-align: left; border: 1px solid #bfdbfe; font-weight: 600;">Time</th>
            <th style="padding: 12px; text-align: left; border: 1px solid #bfdbfe; font-weight: 600;">Client</th>
            <th style="padding: 12px; text-align: left; border: 1px solid #bfdbfe; font-weight: 600;">Clinician</th>
            <th style="padding: 12px; text-align: left; border: 1px solid #bfdbfe; font-weight: 600;">Type</th>
            <th style="padding: 12px; text-align: left; border: 1px solid #bfdbfe; font-weight: 600;">Office</th>
          </tr>
        </thead>
        <tbody>
          ${appointments
            .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
            .map((appt, index) => `
              <tr style="background-color: ${index % 2 === 0 ? '#f8fafc' : 'white'}">
                <td style="padding: 12px; border: 1px solid #bfdbfe;">
                  ${formatDateRange(appt.startTime, appt.endTime)}
                </td>
                <td style="padding: 12px; border: 1px solid #bfdbfe;">
                  ${appt.clientName || `Client ${appt.clientId}`}
                </td>
                <td style="padding: 12px; border: 1px solid #bfdbfe;">
                  ${appt.clinicianName || `Clinician ${appt.clinicianId}`}
                </td>
                <td style="padding: 12px; border: 1px solid #bfdbfe;">
                  ${this.formatSessionType(appt.sessionType)}
                </td>
                <td style="padding: 12px; border: 1px solid #bfdbfe;">
                  ${appt.officeId || 'TBD'}
                </td>
              </tr>
            `).join('')}
        </tbody>
      </table>
    `;
  }

  private static formatSessionType(type: string): string {
    const types: Record<string, string> = {
      'in-person': 'In-Person',
      'telehealth': 'Telehealth',
      'group': 'Group',
      'family': 'Family'
    };
    return types[type] || type;
  }

  private static getAlertBackground(severity: 'high' | 'medium' | 'low'): string {
    switch (severity) {
      case 'high':
        return '#fee2e2';  // Light red
      case 'medium':
        return '#fef3c7';  // Light yellow
      case 'low':
        return '#d1fae5';  // Light green
      default:
        return '#f3f4f6';  // Light gray
    }
  }

  private static getAlertColor(severity: 'high' | 'medium' | 'low'): string {
    switch (severity) {
      case 'high':
        return '#dc2626';  // Red
      case 'medium':
        return '#d97706';  // Yellow
      case 'low':
        return '#059669';  // Green
      default:
        return '#374151';  // Gray
    }
  }

  private static formatAlertsHtml(alerts: DailyScheduleSummary['alerts']): string {
    if (!alerts.length) return '';
    
    return `
      <div style="margin: 1.5em 0;">
        <h2 style="color: #1e40af; margin-bottom: 1em;">Alerts</h2>
        ${alerts.map(alert => `
          <div style="padding: 12px; margin: 8px 0; border-radius: 4px; 
               background-color: ${this.getAlertBackground(alert.severity)};">
            <strong style="color: ${this.getAlertColor(alert.severity)};">
              ${alert.type.toUpperCase()}:
            </strong> 
            ${alert.message}
          </div>
        `).join('')}
      </div>
    `;
  }

  private static formatConflictsHtml(conflicts: DailyScheduleSummary['conflicts']): string {
    if (!conflicts.length) return '';
    
    return `
      <div style="margin: 1.5em 0;">
        <h2 style="color: #1e40af; margin-bottom: 1em;">Conflicts</h2>
        ${conflicts.map(conflict => `
          <div style="padding: 12px; margin: 8px 0; border-radius: 4px; 
               background-color: ${this.getAlertBackground(conflict.severity)};">
            <strong style="color: ${this.getAlertColor(conflict.severity)};">
              ${conflict.type.toUpperCase()}
            </strong>
            <div>${conflict.description}</div>
            ${conflict.officeId ? `<div>Office: ${conflict.officeId}</div>` : ''}
          </div>
        `).join('')}
      </div>
    `;
  }

  private static formatOfficeUtilization(utilization: DailyScheduleSummary['officeUtilization']): string {
    return `
      <table style="width: 100%; border-collapse: collapse;">
        <thead>
          <tr style="background-color: #dbeafe;">
            <th style="padding: 12px; text-align: left; border: 1px solid #bfdbfe; font-weight: 600;">Office</th>
            <th style="padding: 12px; text-align: left; border: 1px solid #bfdbfe; font-weight: 600;">Usage</th>
            <th style="padding: 12px; text-align: left; border: 1px solid #bfdbfe; font-weight: 600;">Notes</th>
          </tr>
        </thead>
        <tbody>
          ${Array.from(utilization.entries()).map(([officeId, data], index) => `
            <tr style="background-color: ${index % 2 === 0 ? '#f8fafc' : 'white'}">
              <td style="padding: 12px; border: 1px solid #bfdbfe;">${officeId}</td>
              <td style="padding: 12px; border: 1px solid #bfdbfe;">
                ${Math.round((data.bookedSlots / data.totalSlots) * 100)}%
              </td>
              <td style="padding: 12px; border: 1px solid #bfdbfe;">
                ${data.specialNotes?.join(', ') || ''}
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }
}// src/lib/email/recipients.ts

import { GoogleSheetsService } from '@/lib/google/sheets';
import type { EmailRecipient } from './service';

export class RecipientManagementService {
  constructor(private readonly sheetsService: GoogleSheetsService) {}

  /**
   * Get all active recipients
   */
  async getAllRecipients(): Promise<EmailRecipient[]> {
    const clinicians = await this.sheetsService.getClinicians();
    
    return clinicians
      .filter(clinician => clinician.email && clinician.role !== 'intern')
      .map(clinician => ({
        email: clinician.email,
        name: clinician.name,
        role: this.mapRole(clinician.role),
        preferences: this.getDefaultPreferences(clinician.role)
      }));
  }

  /**
   * Get recipients by role
   */
  async getRecipientsByRole(role: 'admin' | 'clinician'): Promise<EmailRecipient[]> {
    const allRecipients = await this.getAllRecipients();
    return allRecipients.filter(recipient => recipient.role === role);
  }

  /**
   * Get recipients for daily schedule
   */
  async getDailyScheduleRecipients(): Promise<EmailRecipient[]> {
    const allRecipients = await this.getAllRecipients();
    return allRecipients.filter(
      recipient => recipient.preferences?.dailySchedule !== false
    );
  }

  /**
   * Get recipients for error notifications
   */
  async getErrorNotificationRecipients(): Promise<EmailRecipient[]> {
    const allRecipients = await this.getAllRecipients();
    return allRecipients.filter(
      recipient => recipient.role === 'admin' && recipient.preferences?.errors !== false
    );
  }

  /**
   * Get recipients for conflict notifications
   */
  async getConflictNotificationRecipients(): Promise<EmailRecipient[]> {
    const allRecipients = await this.getAllRecipients();
    return allRecipients.filter(
      recipient => recipient.preferences?.conflicts !== false
    );
  }

  private mapRole(role: string): 'admin' | 'clinician' {
    return role === 'owner' || role === 'admin' ? 'admin' : 'clinician';
  }

  private getDefaultPreferences(role: string): EmailRecipient['preferences'] {
    const isAdmin = role === 'owner' || role === 'admin';

    return {
      dailySchedule: true,
      conflicts: true,
      errors: isAdmin // Only admins get error notifications by default
    };
  }
}// src/lib/email/config.ts

import { EmailService } from './service';
import { GoogleSheetsService } from '@/lib/google/sheets';

interface EmailConfig {
  apiKey: string;
  fromEmail: string;
  fromName: string;
}

export async function initializeEmailService(
  sheetsService: GoogleSheetsService
): Promise<EmailService> {
  // Get required environment variables
  const config = getEmailConfig();

  // Create email service
  return new EmailService(
    config.apiKey,
    config.fromEmail,
    config.fromName,
    sheetsService
  );
}

function getEmailConfig(): EmailConfig {
  const apiKey = process.env.SENDGRID_API_KEY;
  const fromEmail = process.env.EMAIL_FROM_ADDRESS;
  const fromName = process.env.EMAIL_FROM_NAME;

  if (!apiKey || !fromEmail || !fromName) {
    throw new Error('Missing required email configuration environment variables');
  }

  return {
    apiKey,
    fromEmail,
    fromName
  };
}// src/lib/email/service.ts

import type { EmailTemplate } from '@/lib/email/templates';
import SendGrid from '@sendgrid/mail';
import { GoogleSheetsService, AuditEventType } from '@/lib/google/sheets';

export interface EmailRecipient {
  email: string;
  name: string;
  role: 'admin' | 'clinician';
  preferences?: {
    dailySchedule: boolean;
    conflicts: boolean;
    errors: boolean;
  };
}

export class EmailService {
  private readonly fromEmail: string;
  private readonly fromName: string;

  constructor(
    apiKey: string,
    fromEmail: string,
    fromName: string,
    private readonly sheetsService: GoogleSheetsService
  ) {
    SendGrid.setApiKey(apiKey);
    this.fromEmail = fromEmail;
    this.fromName = fromName;
  }

  /**
   * Send email to recipients
   */
  async sendEmail(
    recipients: EmailRecipient[],
    template: EmailTemplate,
    options: {
      type: 'schedule' | 'error' | 'conflict';
      priority?: 'high' | 'normal';
      retryCount?: number;
    }
  ): Promise<void> {
    try {
      const emails = recipients.map(recipient => ({
        to: {
          email: recipient.email,
          name: recipient.name
        },
        from: {
          email: this.fromEmail,
          name: this.fromName
        },
        subject: template.subject,
        html: template.html,
        text: template.text
      }));

      // Log attempt
      await this.sheetsService.addAuditLog({
        timestamp: new Date().toISOString(),
        eventType: 'EMAIL_NOTIFICATION',
        description: `Sending ${options.type} notifications`,
        user: 'SYSTEM',
        systemNotes: JSON.stringify({
          recipientCount: recipients.length,
          subject: template.subject,
          priority: options.priority
        })
      });

      // Send emails in batches of 100 (SendGrid recommendation)
      const batchSize = 100;
      for (let i = 0; i < emails.length; i += batchSize) {
        const batch = emails.slice(i, i + batchSize);
        await SendGrid.send(batch);
      }

      // Log success
      await this.sheetsService.addAuditLog({
        timestamp: new Date().toISOString(),
        eventType: 'EMAIL_NOTIFICATION',
        description: `Successfully sent ${options.type} notifications`,
        user: 'SYSTEM',
        systemNotes: JSON.stringify({
          recipientCount: recipients.length,
          subject: template.subject
        })
      });
    } catch (error) {
      console.error('Error sending emails:', error);

      // Log error
      await this.sheetsService.addAuditLog({
        timestamp: new Date().toISOString(),
        eventType: AuditEventType.SYSTEM_ERROR,
        description: `Failed to send ${options.type} notifications`,
        user: 'SYSTEM',
        systemNotes: error instanceof Error ? error.message : 'Unknown error'
      });

      // Retry if specified
      if (options.retryCount && options.retryCount > 0) {
        console.log(`Retrying email send (${options.retryCount} attempts remaining)...`);
        await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second before retry
        return this.sendEmail(recipients, template, {
          ...options,
          retryCount: options.retryCount - 1
        });
      }

      throw error;
    }
  }

  /**
   * Filter recipients based on preferences
   */
  filterRecipientsByPreference(
    recipients: EmailRecipient[],
    type: 'dailySchedule' | 'conflicts' | 'errors'
  ): EmailRecipient[] {
    return recipients.filter(recipient => {
      if (!recipient.preferences) return true; // Default to including if no preferences set
      return recipient.preferences[type] !== false; // Include unless explicitly set to false
    });
  }

  /**
   * Get admin recipients from sheets
   */
  async getAdminRecipients(): Promise<EmailRecipient[]> {
    try {
      const clinicians = await this.sheetsService.getClinicians();
      
      return clinicians
        .filter(clinician => clinician.role === 'admin' || clinician.role === 'owner')
        .map(clinician => ({
          email: clinician.email,
          name: clinician.name,
          role: clinician.role === 'owner' || clinician.role === 'admin' ? 'admin' as const : 'clinician' as const,
          preferences: {
            dailySchedule: true,
            conflicts: true,
            errors: true
          }
        }));
    } catch (error) {
      console.error('Error getting admin recipients:', error);
      throw error;
    }
  }

  /**
   * Get clinician recipients
   */
  async getClinicianRecipients(): Promise<EmailRecipient[]> {
    try {
      const clinicians = await this.sheetsService.getClinicians();
      
      return clinicians
        .filter(clinician => clinician.role === 'clinician' || clinician.role === 'intern')
        .map(clinician => ({
          email: clinician.email,
          name: clinician.name,
          role: 'clinician',
          preferences: {
            dailySchedule: true,
            conflicts: true,
            errors: false
          }
        }));
    } catch (error) {
      console.error('Error getting clinician recipients:', error);
      throw error;
    }
  }
}// src/types/webhooks.ts

export type WebhookEventType = 
  | 'Form Submitted'
  | 'Intake Submitted'
  | 'AppointmentCreated'
  | 'AppointmentUpdated'
  | 'AppointmentRescheduled'
  | 'AppointmentCancelled'
  | 'Appointment Created'  // Keep old formats for backward compatibility
  | 'Appointment Updated'
  | 'Appointment Rescheduled'
  | 'Appointment Cancelled'
  | 'AppointmentCanceled'
  | 'Appointment Canceled'
  | 'AppointmentDeleted'
  | 'Appointment Deleted';

export interface IntakeQAppointment {
  Id: string;
  ClientName: string;
  ClientEmail: string;
  ClientPhone: string;
  ClientDateOfBirth: string;
  ClientId: number;
  Status: string;
  StartDate: number;
  EndDate: number;
  Duration: number;
  ServiceName: string;
  ServiceId: string;
  LocationName: string;
  LocationId: string;
  Price: number;
  PractitionerName: string;
  PractitionerEmail: string;
  PractitionerId: string;
  IntakeId: string | null;
  DateCreated: number;
  CreatedBy: string;
  BookedByClient: boolean;
  ExternalClientId?: string;
  StartDateIso: string;
  EndDateIso: string;
  StartDateLocal: string;
  EndDateLocal: string;
  StartDateLocalFormatted: string;
  CancellationReason?: string;
  RecurrencePattern?: {
    frequency: 'weekly' | 'biweekly' | 'monthly';
    occurrences: number;
    endDate?: string;
  };
  [key: string]: any;
}

export interface IntakeQWebhookPayload {
  IntakeId?: string;
  Type?: WebhookEventType;  // Keep Type for backward compatibility
  EventType: WebhookEventType; // Make EventType required
  ClientId: number;
  ExternalClientId?: string;
  PracticeId: string;
  ExternalPracticeId?: string | null;
  formId?: string;
  responses?: Record<string, any>;
  Appointment?: IntakeQAppointment;
  ActionPerformedByClient?: boolean;
}

export interface WebhookResponse {
  success: boolean;
  error?: string;
  details?: any;
}

export class WebhookError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number = 500,
    public readonly details?: any
  ) {
    super(message);
    this.name = 'WebhookError';
  }
}// src/types/scheduling.ts

export type SessionType = 'in-person' | 'telehealth' | 'group' | 'family';
export type AppointmentSource = 'intakeq' | 'manual';
// Add after export type AppointmentSource = 'intakeq' | 'manual';
export type AlertSeverity = 'high' | 'medium' | 'low';

export interface AppointmentRecord {
  appointmentId: string;
  clientId: string;
  clientName: string; // Add this property
  clinicianId: string;
  clinicianName: string; // Add this property
  officeId: string;
  sessionType: 'in-person' | 'telehealth' | 'group' | 'family';
  startTime: string;
  endTime: string;
  status: 'scheduled' | 'completed' | 'cancelled' | 'rescheduled';
  lastUpdated: string;
  source: 'intakeq' | 'manual'; // Update the type to a union type
  requirements?: {
    accessibility?: boolean;
    specialFeatures?: string[];
  };
  notes?: string;
}

export interface DailyScheduleSummary {
  date: string;
  appointments: AppointmentRecord[];
  conflicts: Array<{
    type: string;
    description: string;
    severity: AlertSeverity;
    officeId?: string;
    appointmentIds?: string[];
  }>;
  alerts: Array<{
    type: string;
    message: string;
    severity: AlertSeverity;
  }>;
  officeUtilization: Map<string, {
    totalSlots: number;
    bookedSlots: number;
    specialNotes?: string[];
  }>;
}

export interface SchedulingRequest {
  clientId: string;
  clinicianId: string;
  dateTime: string;
  duration: number;
  sessionType: SessionType;
  clientAge?: number;
  requirements?: {
    accessibility?: boolean;
    roomPreference?: string;
    specialFeatures?: string[];
  };
}

export interface SchedulingResult {
  success: boolean;
  officeId?: string;
  conflicts?: SchedulingConflict[];
  notes?: string;
  error?: string;
  evaluationLog?: string[];
}

export interface SchedulingConflict {
  officeId: string;
  existingBooking: {
    clientId: string;
    clinicianId: string;
    sessionType: SessionType;
    dateTime: string;
    duration: number;
  };
  resolution?: {
    type: 'relocate' | 'cannot-relocate';
    reason: string;
    newOfficeId?: string;
  };
}

export interface TimeSlotRequest {
  officeId: string;
  dateTime: string;
  duration: number;
}

export interface ValidationResult {
  isValid: boolean;
  conflicts?: string[];
  error?: string;
}import type { IntakeQAppointment } from './webhooks';

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  timestamp: string;
}

export interface AppointmentConflict {
  type: 'double-booking' | 'capacity' | 'accessibility';
  description: string;
  severity: 'high' | 'medium' | 'low';
  officeId?: string;
  appointmentIds?: string[];
}

export interface ValidationResponse {
  isValid: boolean;
  conflicts: AppointmentConflict[];
  error?: string;
}

export interface SchedulingResponse extends ApiResponse<{
  appointmentId: string;
  officeId?: string;
  action: string;
  conflicts?: AppointmentConflict[];
}> {}

export interface DailySyncResponse extends ApiResponse<{
  date: string;
  appointmentCount: number;
  conflicts: AppointmentConflict[];
  alerts: Array<{
    type: string;
    message: string;
    severity: 'high' | 'medium' | 'low';
  }>;
}> {}// src/lib/types.ts

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
  }// src/types/intakeq.ts

// Interface for appointments from IntakeQ
export interface IntakeQAppointment {
    Id: string;
    ClientName: string;
    ClientEmail: string;
    ClientPhone: string;
    ClientDateOfBirth: string;
    ClientId: number;
    Status: string;
    StartDate: number;
    EndDate: number;
    Duration: number;
    ServiceName: string;
    ServiceId: string;
    LocationName: string;
    LocationId: string;
    Price: number;
    PractitionerName: string;
    PractitionerEmail: string;
    PractitionerId: string;
    IntakeId: string | null;
    DateCreated: number;
    CreatedBy: string;
    BookedByClient: boolean;
    ExternalClientId?: string;
    StartDateIso: string;
    EndDateIso: string;
    StartDateLocal: string;
    EndDateLocal: string;
    StartDateLocalFormatted: string;
}

// Interface for office assignment requests
export interface AssignmentRequest {
    appointment: IntakeQAppointment;
    clientPreferences?: {
        mobilityNeeds: string[];
        sensoryPreferences: string[];
        physicalNeeds: string[];
        roomConsistency: number;
        supportNeeds: string[];
    };
    requirements?: {
        accessibility?: boolean;
        specialFeatures?: string[];
    };
}

// Interface for office assignment results
export interface AssignmentResult {
    success: boolean;
    appointmentId: string;
    officeId?: string;
    error?: string;
    notes?: string;
    evaluationLog?: string[];
}

// Interface for webhook payload from IntakeQ
export interface IntakeQWebhookPayload {
    IntakeId?: string;
    Type: 'Intake Submitted' | 'Appointment Created' | 'Appointment Updated';
    ClientId: number;
    ExternalClientId?: string;
    PracticeId: string;
    ExternalPracticeId?: string | null;
    formId?: string;
    responses?: Record<string, any>;
    Appointment?: IntakeQAppointment;
    ActionPerformedByClient?: boolean;
}

// Interface for notifications about office assignments
export interface AssignmentNotification {
    type: 'assignment' | 'reassignment' | 'error';
    appointmentId: string;
    officeId?: string;
    clinicianEmail: string;
    message: string;
    changes?: {
        previousOffice?: string;
        newOffice?: string;
        reason?: string;
    };
}declare global {
    namespace NodeJS {
      interface ProcessEnv {
        GOOGLE_SHEETS_PRIVATE_KEY: string;
        GOOGLE_SHEETS_CLIENT_EMAIL: string;
        GOOGLE_SHEETS_SPREADSHEET_ID: string;
      }
    }
  }
  
  // Ensure this is treated as a module
  export {};// src/types/sheets.ts

export interface SheetOffice {
  officeId: string;
  name: string;
  unit: string;
  inService: boolean;
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

export interface SheetClinician {
  clinicianId: string;
  name: string;
  email: string;
  role: 'owner' | 'admin' | 'clinician' | 'intern';
  ageRangeMin: number;
  ageRangeMax: number;
  specialties: string[];
  caseloadLimit: number;
  currentCaseload: number;
  preferredOffices: string[];
  allowsRelationship: boolean;
  certifications: string[];
  intakeQPractitionerId: string;
}

export interface AssignmentRule {
  priority: number;
  ruleName: string;
  ruleType: string;
  condition: string;
  officeIds: string[];
  overrideLevel: 'hard' | 'soft' | 'none';
  active: boolean;
  notes?: string;
}

export interface ClientPreference {
  clientId: string;
  name: string;
  email: string;
  mobilityNeeds: string[];
  sensoryPreferences: string[];
  physicalNeeds: string[];
  roomConsistency: number;
  supportNeeds: string[];
  specialFeatures: string[];  // Added this field
  additionalNotes?: string;
  lastUpdated: string;
  preferredClinician?: string;
  assignedOffice?: string;
}

export interface ScheduleConfig {
  settingName: string;
  value: string;
  description: string;
  lastUpdated: string;
  updatedBy: string;
}

export interface IntegrationSetting {
  serviceName: string;
  settingType: string;
  value: string;
  description: string;
  lastUpdated: string;
}

export interface AuditLogEntry {
  timestamp: string;
  eventType: string;
  description: string;
  user: string;
  previousValue?: string;
  newValue?: string;
  systemNotes?: string;
}