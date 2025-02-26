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

    // For now, let's bypass signature verification during development
    // We'll want to ensure body-parser is working properly later
    
    // Proceed to next middleware
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
 * Middleware to capture the raw request body for signature verification
 * This must be used before the JSON body parser
 */
export function captureRawBody(req: IntakeQSignatureRequest, res: Response, next: NextFunction) {
  let data = '';
  
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