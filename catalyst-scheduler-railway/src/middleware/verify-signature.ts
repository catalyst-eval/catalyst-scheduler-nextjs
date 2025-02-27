import { Request, Response, NextFunction } from 'express';

export interface IntakeQWebhookRequest extends Request {
  rawBody?: string;
}

/**
 * Simple pass-through middleware that doesn't touch the request body
 */
export function handleIntakeQWebhook(req: Request, res: Response, next: NextFunction) {
  // Just pass through to the next middleware
  next();
}

/**
 * Basic validation for IntakeQ webhooks
 */
export function validateIntakeQWebhook(req: IntakeQWebhookRequest, res: Response, next: NextFunction) {
  try {
    const payload = req.body;
    
    // Log all incoming webhooks for debugging
    console.log('Webhook headers:', req.headers);
    console.log('Webhook body:', payload);
    
    // Minimal validation - proceed with most payloads
    if (!payload) {
      console.warn('Empty webhook payload');
      return res.status(400).json({ 
        success: false, 
        error: 'Empty webhook payload',
        timestamp: new Date().toISOString() 
      });
    }
    
    // Payload exists, proceed
    next();
  } catch (error) {
    console.error('Error processing webhook:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown webhook processing error',
      timestamp: new Date().toISOString()
    });
  }
}