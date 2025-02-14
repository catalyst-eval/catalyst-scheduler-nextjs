import { NextResponse } from 'next/server';
import { initializeGoogleSheets } from '@/lib/google/auth';
import { AppointmentSyncHandler } from '@/lib/intakeq/appointment-sync';
import { processAccessibilityForm } from '@/lib/intakeq/accessibility-form';
import { IntakeQService } from '@/lib/intakeq/service';
import { initializeEmailService } from '@/lib/email/config';
import type { 
  IntakeQWebhookPayload, 
  WebhookResponse 
} from '@/types/webhooks';
import type { 
  ApiResponse, 
  ValidationResponse 
} from '@/types/api';

export async function GET() {
  return NextResponse.json({
    status: 'ok',
    message: 'IntakeQ webhook endpoint active',
    timestamp: new Date().toISOString()
  });
}

export async function POST(
  request: Request
): Promise<NextResponse<ApiResponse<WebhookResponse>>> {
  let sheetsService;
  
  try {
    // Get webhook signature
    const signature = request.headers.get('x-intakeq-signature');
    const rawBody = await request.text();

    // Initialize services
    sheetsService = await initializeGoogleSheets();
    const intakeqService = new IntakeQService(
      process.env.INTAKEQ_API_KEY!,
      sheetsService
    );
    const emailService = await initializeEmailService(sheetsService);

    // Validate signature
    if (!signature || !await intakeqService.validateWebhookSignature(rawBody, signature)) {
      return NextResponse.json({
        success: false,
        error: 'Invalid webhook signature',
        timestamp: new Date().toISOString()
      }, { 
        status: 401 
      });
    }

    // Parse and validate payload
    let payload: IntakeQWebhookPayload;
    try {
      payload = JSON.parse(rawBody);
    } catch (e) {
      throw new Error('Invalid JSON payload');
    }

    // Validate required fields
    if (!payload.Type || !payload.ClientId) {
      throw new Error('Missing required fields: Type or ClientId');
    }

    // Log webhook receipt
    await sheetsService.addAuditLog({
      timestamp: new Date().toISOString(),
      eventType: 'WEBHOOK_RECEIVED',
      description: `Received ${payload.Type} webhook`,
      user: 'INTAKEQ_WEBHOOK',
      systemNotes: JSON.stringify({
        type: payload.Type,
        clientId: payload.ClientId,
        appointmentId: payload.Appointment?.Id
      })
    });

    // Process based on webhook type
    if (payload.Type === 'Intake Submitted' || payload.Type === 'Form Submitted') {
      // Handle accessibility form submissions
      if (payload.formId === '67a52367e11d09a2b82d57a9') {
        if (!payload.responses) {
          throw new Error('Missing form responses');
        }

        const clientPrefs = processAccessibilityForm({
          ...payload.responses,
          clientId: payload.ClientId.toString(),
          clientName: payload.responses.clientName,
          clientEmail: payload.responses.clientEmail
        });
        
        await sheetsService.updateClientPreference(clientPrefs);

        return NextResponse.json({
          success: true,
          data: {
            success: true,
            details: {
              clientId: payload.ClientId,
              action: 'preferences-updated'
            }
          },
          timestamp: new Date().toISOString()
        });
      }
    } else if (payload.Type.startsWith('Appointment')) {
      // Handle appointment events
      const appointmentHandler = new AppointmentSyncHandler(
        sheetsService,
        intakeqService,
        emailService
      );
      
      const result = await appointmentHandler.processAppointmentEvent(payload);
      
      return NextResponse.json({
        success: true,
        data: result,
        timestamp: new Date().toISOString()
      });
    }

    // Unknown event type
    throw new Error(`Unsupported event type: ${payload.Type}`);

  } catch (error) {
    console.error('Webhook processing error:', error);

    // Try to log error
    try {
      if (sheetsService) {
        await sheetsService.addAuditLog({
          timestamp: new Date().toISOString(),
          eventType: 'SYSTEM_ERROR',
          description: error instanceof Error ? error.message : 'Unknown error',
          user: 'SYSTEM',
          systemNotes: JSON.stringify({
            error: error instanceof Error ? {
              message: error.message,
              stack: error.stack
            } : error,
            timestamp: new Date().toISOString()
          })
        });
      }
    } catch (logError) {
      console.error('Failed to log error:', logError);
    }
    
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
      timestamp: new Date().toISOString()
    }, { 
      status: error instanceof Error && error.message.includes('Invalid signature') ? 401 : 500
    });
  }
}