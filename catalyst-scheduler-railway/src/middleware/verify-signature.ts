import { Request, Response, NextFunction } from 'express';

export interface IntakeQWebhookRequest extends Request {
  rawBody?: string;
}

/**
 * Middleware to capture the raw request body from IntakeQ webhook
 */
export function captureRawBody(req: IntakeQWebhookRequest, res: Response, next: NextFunction) {
  let data = '';
  
  req.setEncoding('utf8');
  
  req.on('data', chunk => {
    data += chunk;
  });
  
  req.on('end', () => {
    req.rawBody = data;
    next();
  });

  req.on('error', (error) => {
    console.error('Error capturing raw body:', error);
    next(error);
  });
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