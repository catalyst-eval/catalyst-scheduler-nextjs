import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import { verifyIntakeQSignature, IntakeQSignatureRequest } from '../middleware/verify-signature';
import { WebhookHandler } from '../lib/intakeq/webhook-handler';
import { AppointmentSyncHandler } from '../lib/intakeq/appointment-sync';
import GoogleSheetsService from '../lib/google/sheets';

// Create router
const router = express.Router();

// Initialize services
const sheetsService = new GoogleSheetsService();
const appointmentSyncHandler = new AppointmentSyncHandler(sheetsService);
const webhookHandler = new WebhookHandler(sheetsService);

// Define route handlers separately to avoid TypeScript issues
const verifySignature = (req: Request, res: Response, next: NextFunction): void => {
  verifyIntakeQSignature(req as IntakeQSignatureRequest, res, next);
};

const handleWebhook = async (req: Request, res: Response): Promise<void> => {
  const startTime = Date.now();
  console.log(`[${new Date().toISOString()}] Starting webhook processing`);
  
  try {
    const payload = req.body;

    console.log('Received webhook:', { 
      type: payload.EventType || payload.Type,
      clientId: payload.ClientId,
      appointmentId: payload.Appointment?.Id,
      timestamp: new Date().toISOString()
    });

    // Check if it's an appointment event
    const eventType = payload.EventType || payload.Type;
    const isAppointmentEvent = eventType && (
      eventType.includes('Appointment') || eventType.includes('appointment')
    );

    // Use appropriate handler
    const processPromise = isAppointmentEvent 
      ? appointmentSyncHandler.processAppointmentEvent(payload)
      : webhookHandler.processWebhook(payload);

    const result = await processPromise;
    const processingTime = Date.now() - startTime;
    
    console.log('Webhook event processed:', {
      ...result,
      processingTime: `${processingTime}ms`
    });

    // Return appropriate response
    if (!result.success) {
      res.status(400).json({
        success: false,
        error: result.error,
        details: result.details,
        processingTime,
        timestamp: new Date().toISOString()
      });
    } else {
      res.json({
        success: true,
        data: result.details,
        processingTime,
        timestamp: new Date().toISOString()
      });
    }
  } catch (error: unknown) {
    const processingTime = Date.now() - startTime;
    console.error('Webhook processing error:', {
      error,
      processingTime: `${processingTime}ms`
    });
    
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
      processingTime,
      timestamp: new Date().toISOString()
    });
  }
};

const handleTestWebhook = async (req: Request, res: Response): Promise<void> => {
  try {
    const payload = req.body;
    console.log('Received test webhook:', payload);
    
    if (!payload || !payload.Type) {
      res.status(400).json({
        success: false,
        error: 'Invalid payload format. Must include Type field.'
      });
      return;
    }
    
    // Process without signature verification
    const isAppointmentEvent = payload.Type && (
      payload.Type.includes('Appointment') || payload.Type.includes('appointment')
    );

    // Use appropriate handler
    const processPromise = isAppointmentEvent 
      ? appointmentSyncHandler.processAppointmentEvent(payload)
      : webhookHandler.processWebhook(payload);
    
    try {
      const result = await processPromise;
      res.json({
        success: result.success,
        data: result.details,
        error: result.error,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    });
  }
};

const getRecentWebhooks = async (req: Request, res: Response): Promise<void> => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 10;
    const logs = await sheetsService.getRecentAuditLogs(limit);
    
    const webhookLogs = logs.filter(log => 
      log.eventType === 'WEBHOOK_RECEIVED' || 
      log.eventType.includes('APPOINTMENT_')
    );
    
    res.json({
      success: true,
      data: webhookLogs,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    });
  }
};

const getHealth = (req: Request, res: Response): void => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    webhooks: {
      intakeq: {
        enabled: true,
        config: {
          secretConfigured: !!process.env.INTAKEQ_WEBHOOK_SECRET
        }
      }
    }
  });
};

// Apply middleware and routes
router.use('/intakeq', verifySignature);
router.post('/intakeq', handleWebhook);
router.post('/test-webhook', handleTestWebhook);
router.get('/recent', getRecentWebhooks);
router.get('/health', getHealth);

export default router;