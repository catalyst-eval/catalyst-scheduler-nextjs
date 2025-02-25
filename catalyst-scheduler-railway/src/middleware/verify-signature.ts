import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

export interface IntakeQSignatureRequest extends Request {
  rawBody?: string;
}

/**
 * Middleware to verify IntakeQ webhook signatures
 */
export function verifyIntakeQSignature(req: IntakeQSignatureRequest, res: Response, next: NextFunction) {
  try {
    console.log('Starting signature verification...');
    console.log('Headers:', JSON.stringify(req.headers));
    
    const signature = req.headers['x-intakeq-signature'] as string;
    
    if (!signature) {
      console.warn('Missing signature in webhook request');
      return res.status(401).json({ 
        success: false, 
        error: 'Missing signature',
        timestamp: new Date().toISOString() 
      });
    }

    // Get the raw body
    const rawBody = req.rawBody;
    
    if (!rawBody) {
      console.error('Raw body not available for signature verification');
      return res.status(500).json({
        success: false,
        error: 'Cannot verify webhook signature - raw body not available',
        timestamp: new Date().toISOString()
      });
    }

    console.log('Raw body length:', rawBody.length);
    console.log('Raw body preview:', rawBody.substring(0, 100) + '...');

    // Validate the signature
    const secret = process.env.INTAKEQ_WEBHOOK_SECRET;
    
    if (!secret) {
      console.error('Missing INTAKEQ_WEBHOOK_SECRET environment variable');
      return res.status(500).json({
        success: false,
        error: 'Webhook secret not configured',
        timestamp: new Date().toISOString()
      });
    }

    // Remove any quotes from the secret
    const cleanSecret = secret.replace(/['"]/g, '');

    // Create HMAC
    const hmac = crypto.createHmac('sha256', cleanSecret);
    hmac.update(rawBody);
    const calculatedSignature = hmac.digest('hex');

    console.log('Webhook Signature Validation:', {
      signatureMatches: calculatedSignature === signature,
      calculatedLength: calculatedSignature.length,
      providedLength: signature.length,
      payloadLength: rawBody.length,
    });

    if (calculatedSignature !== signature) {
      console.warn('Invalid signature in webhook request');
      return res.status(401).json({
        success: false,
        error: 'Invalid signature',
        timestamp: new Date().toISOString()
      });
    }

    console.log('Signature verified successfully!');
    // Signature is valid, proceed
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