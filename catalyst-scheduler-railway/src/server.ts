// This must be the very first import
import dotenv from 'dotenv';
// Load environment variables immediately
dotenv.config();

// Add environment debugging
console.log('Environment variables:');
console.log('NODE_ENV:', process.env.NODE_ENV || 'not set');
console.log('GOOGLE_SHEETS_PRIVATE_KEY exists:', !!process.env.GOOGLE_SHEETS_PRIVATE_KEY);
console.log('GOOGLE_SHEETS_CLIENT_EMAIL exists:', !!process.env.GOOGLE_SHEETS_CLIENT_EMAIL);
console.log('GOOGLE_SHEETS_SPREADSHEET_ID exists:', !!process.env.GOOGLE_SHEETS_SPREADSHEET_ID);
console.log('INTAKEQ_WEBHOOK_SECRET exists:', !!process.env.INTAKEQ_WEBHOOK_SECRET);

import express, { Request, Response, NextFunction } from 'express';
import testRoutes from './routes/test';
import webhookRoutes from './routes/webhooks';
import { captureRawBody } from './middleware/verify-signature';

const app = express();

// Special handling for IntakeQ webhook path - we need to capture the raw body before JSON parsing
app.use('/api/webhooks/intakeq', captureRawBody);

// Regular JSON parsing for all other routes
app.use(express.json());

// Routes
app.use('/api/test', testRoutes);
app.use('/api/webhooks', webhookRoutes);

// Health check endpoint
app.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
    env_vars_loaded: {
      GOOGLE_SHEETS_CLIENT_EMAIL: !!process.env.GOOGLE_SHEETS_CLIENT_EMAIL,
      GOOGLE_SHEETS_SPREADSHEET_ID: !!process.env.GOOGLE_SHEETS_SPREADSHEET_ID,
      GOOGLE_SHEETS_PRIVATE_KEY: !!process.env.GOOGLE_SHEETS_PRIVATE_KEY,
      INTAKEQ_WEBHOOK_SECRET: !!process.env.INTAKEQ_WEBHOOK_SECRET
    }
  });
});

// Error handling middleware
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error(err.stack);
  res.status(500).json({
    success: false,
    error: 'Internal Server Error',
    timestamp: new Date().toISOString()
  });
});

// Handle 404s
app.use((req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    error: 'Not Found',
    timestamp: new Date().toISOString()
  });
});

const port = process.env.PORT || 3001;

if (require.main === module) {
  app.listen(port, () => {
    console.log(`Server running on port ${port}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`Webhook endpoint available at: http://localhost:${port}/api/webhooks/intakeq`);
  });
}

export { app };