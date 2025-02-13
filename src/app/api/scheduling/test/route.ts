// src/app/api/scheduling/test/route.ts

import { NextResponse } from 'next/server';
import { initializeGoogleSheets } from '@/lib/google/auth';
import { AuditEventType } from '@/lib/google/sheets';
import { OfficeAssignmentService } from '@/lib/scheduling/office-assignment';
import type { SchedulingRequest } from '@/types/scheduling';
import type { SheetClinician, ClientPreference } from '@/types/sheets';

// Test endpoint modes
type TestMode = 'webhook' | 'assignment' | 'conflict';

interface TestResponse {
  success: boolean;
  mode: TestMode;
  results: any;
  logs: string[];
}

export async function POST(request: Request) {
  const logs: string[] = [];
  try {
    // Parse request body
    const rawBody = await request.text();
    logs.push(`Received payload: ${rawBody}`);

    let payload;
    try {
      payload = JSON.parse(rawBody);
    } catch (e) {
      return NextResponse.json({ 
        success: false, 
        error: 'Invalid JSON payload',
        logs 
      }, { status: 400 });
    }

    // Initialize sheets service
    const sheetsService = await initializeGoogleSheets();
    logs.push('Google Sheets service initialized');

    // Determine test mode
    const mode = payload.mode as TestMode;
    logs.push(`Test mode: ${mode}`);

    let results;
    switch (mode) {
      case 'webhook':
        // Test webhook processing
        results = await testWebhook(payload.data, sheetsService, logs);
        break;

      case 'assignment':
        // Test office assignment
        results = await testAssignment(payload.data, sheetsService, logs);
        break;

      case 'conflict':
        // Test conflict resolution
        results = await testConflict(payload.data, sheetsService, logs);
        break;

      default:
        return NextResponse.json({ 
          success: false, 
          error: 'Invalid test mode',
          logs 
        }, { status: 400 });
    }

    // Log test execution
    await sheetsService.addAuditLog({
      timestamp: new Date().toISOString(),
      eventType: AuditEventType.WEBHOOK_RECEIVED,
      description: `Test execution: ${mode}`,
      user: 'TEST_SYSTEM',
      systemNotes: JSON.stringify({ payload, results })
    });

    return NextResponse.json({
      success: true,
      mode,
      results,
      logs
    });

  } catch (error) {
    console.error('Test endpoint error:', error);
    logs.push(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    
    return NextResponse.json({
      success: false,
      error: 'Test execution failed',
      logs
    }, { status: 500 });
  }
}

async function testWebhook(data: any, sheetsService: any, logs: string[]) {
  logs.push('Testing webhook processing...');
  
  // Validate webhook structure
  if (!data.Type || !data.ClientId) {
    throw new Error('Invalid webhook structure');
  }

  // Log webhook receipt
  await sheetsService.addAuditLog({
    timestamp: new Date().toISOString(),
    eventType: AuditEventType.WEBHOOK_RECEIVED,
    description: 'Test webhook received',
    user: 'TEST_SYSTEM',
    systemNotes: JSON.stringify(data)
  });

  logs.push('Webhook validated and logged');
  return { webhookValid: true };
}

async function testAssignment(data: SchedulingRequest, sheetsService: any, logs: string[]) {
  logs.push('Testing office assignment...');

  // Get required data
  const [offices, rules, clinicians, clientPreferences] = await Promise.all([
    sheetsService.getOffices(),
    sheetsService.getAssignmentRules(),
    sheetsService.getClinicians(),
    sheetsService.getClientPreferences()
  ]);

  logs.push(`Retrieved ${offices.length} offices and ${rules.length} rules`);

  // Create assignment service
  const assignmentService = new OfficeAssignmentService(
    offices,
    rules,
    clinicians,
    clientPreferences.find((pref: ClientPreference) => pref.clientId === data.clientId)
  );

  // Find optimal office
  const result = await assignmentService.findOptimalOffice(data);
  logs.push(`Assignment result: ${result.success ? 'Success' : 'Failed'}`);

  return result;
}

async function testConflict(data: any, sheetsService: any, logs: string[]) {
  logs.push('Testing conflict resolution...');

  const { request, existingBookings } = data;

  // Get required data
  const [offices, clinicians] = await Promise.all([
    sheetsService.getOffices(),
    sheetsService.getClinicians()
  ]);
  logs.push(`Retrieved ${offices.length} offices and ${clinicians.length} clinicians`);

  // Create booking map
  const bookingsMap = new Map();
  existingBookings.forEach((booking: any) => {
    if (!bookingsMap.has(booking.officeId)) {
      bookingsMap.set(booking.officeId, []);
    }
    bookingsMap.get(booking.officeId).push(booking);
  });

  // Create assignment service
  const assignmentService = new OfficeAssignmentService(
    offices,
    [],
    clinicians,
    undefined,
    bookingsMap
  );

  // Test assignment with conflicts
  const result = await assignmentService.findOptimalOffice(request);
  logs.push(`Conflict resolution result: ${result.success ? 'Success' : 'Failed'}`);

  return result;
}

// Enable GET for connection testing
export async function GET() {
  return NextResponse.json({
    status: 'ok',
    message: 'Test endpoint active',
    timestamp: new Date().toISOString()
  });
}