import express, { Request, Response, NextFunction } from 'express';
import { verifyIntakeQSignature, IntakeQSignatureRequest, captureRawBody } from '../middleware/verify-signature';
import WebhookHandler from '../lib/intakeq/webhook-handler';
import GoogleSheetsService from '../lib/google/sheets';

// Create router
const router = express.Router();

// Initialize services
const sheetsService = new GoogleSheetsService();
const webhookHandler = new WebhookHandler(sheetsService);

// Apply middleware pipeline for IntakeQ webhook
// 1. First capture raw body for signature verification
router.use('/intakeq', captureRawBody);

// 2. Then verify the signature
router.use('/intakeq', (req: Request, res: Response, next: NextFunction) => {
  verifyIntakeQSignature(req as IntakeQSignatureRequest, res, next);
});

// Handle IntakeQ webhooks
router.post('/intakeq', (req: Request, res: Response) => {
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

    // Process the webhook
    webhookHandler.processWebhook(payload)
      .then(result => {
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
      })
      .catch(error => {
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
      });
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
});

// Health check endpoint
router.get('/health', (req: Request, res: Response) => {
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
});

export default router;