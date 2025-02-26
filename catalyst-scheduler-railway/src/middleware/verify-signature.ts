import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

export interface IntakeQSignatureRequest extends Request {
  rawBody?: string;
}

/**
 * Middleware to verify IntakeQ webhook signatures
 * This validates that the request is authentic and coming from IntakeQ
 */
export function verifyIntakeQSignature(req: IntakeQSignatureRequest, res: Response, next: NextFunction) {
  try {
    const signature = req.headers['x-intakeq-signature'] as string;
    
    if (!signature) {
      console.warn('Missing signature in webhook request');
      return res.status(401).json({ 
        success: false, 
        error: 'Missing signature',
        timestamp: new Date().toISOString() 
      });
    }

    // Get the raw body that was captured by the raw body parser
    const rawBody = req.rawBody;
    
    if (!rawBody) {
      console.error('Raw body not available for signature verification');
      return res.status(500).json({
        success: false,
        error: 'Cannot verify webhook signature - raw body not available',
        timestamp: new Date().toISOString()
      });
    }

    // Validate the signature
    const isValid = validateSignature(rawBody, signature);
    
    if (!isValid) {
      console.warn('Invalid signature in webhook request');
      console.warn('Received signature:', signature);
      
      // For debugging only - log what the signature should be
      const webhookSecret = process.env.INTAKEQ_WEBHOOK_SECRET || '';
      const cleanSecret = webhookSecret.replace(/['"]/g, '');
      const hmac = crypto.createHmac('sha256', cleanSecret);
      hmac.update(rawBody);
      const calculatedSignature = hmac.digest('hex');
      console.warn('Calculated signature:', calculatedSignature);
      
      return res.status(401).json({
        success: false,
        error: 'Invalid signature',
        timestamp: new Date().toISOString()
      });
    }

    // Signature is valid, proceed to next middleware
    next();
  } catch (error) {
    console.error('Error verifying webhook signature:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown signature verification error',
      timestamp: new Date().toISOString()
    });
  }
}

/**
 * Validate the HMAC signature from IntakeQ
 */
function validateSignature(payload: string, signature: string): boolean {
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
      calculatedSignatureStart: calculatedSignature.substring(0, 10) + '...',
      providedSignatureStart: signature.substring(0, 10) + '...',
      payloadLength: payload.length,
    });

    return calculatedSignature === signature;
  } catch (error) {
    console.error('Webhook signature validation error:', error);
    return false;
  }
}

/**
 * Middleware to capture the raw request body for signature verification
 * This must be used before the JSON body parser
 */
export function captureRawBody(req: IntakeQSignatureRequest, res: Response, next: NextFunction) {
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