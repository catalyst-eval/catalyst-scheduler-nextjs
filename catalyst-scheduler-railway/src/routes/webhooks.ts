import express, { Request, Response, NextFunction } from 'express';
import { verifyIntakeQSignature, IntakeQSignatureRequest } from '../middleware/verify-signature';
import { WebhookHandler } from '../lib/intakeq/webhook-handler';
import GoogleSheetsService from '../lib/google/sheets';

// Create router
const router = express.Router();

// Initialize services
const sheetsService = new GoogleSheetsService();
const webhookHandler = new WebhookHandler(sheetsService);

// Add a simple test route to verify the router is working
router.get('/test', (req: Request, res: Response) => {
  res.json({
    success: true,
    message: 'Webhook routes are accessible',
    timestamp: new Date().toISOString(),
    configured: !!process.env.INTAKEQ_WEBHOOK_SECRET
  });
});

// Handle IntakeQ webhooks with signature verification middleware
// Use a type assertion to help TypeScript understand the middleware compatibility
router.post('/intakeq', 
  ((req, res, next) => verifyIntakeQSignature(req as IntakeQSignatureRequest, res, next)) as express.RequestHandler,
  (req: Request, res: Response) => {
    const startTime = Date.now();
    console.log(`[${new Date().toISOString()}] Starting webhook processing`);
    
    try {
      const payload = req.body;
      console.log('Processing webhook payload:', JSON.stringify(payload));

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