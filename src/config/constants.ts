// src/config/constants.ts

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
  } as const;