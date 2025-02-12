// src/lib/email/config.ts

import { EmailService } from './service';
import { GoogleSheetsService } from '@/lib/google/sheets';

interface EmailConfig {
  apiKey: string;
  fromEmail: string;
  fromName: string;
}

export async function initializeEmailService(
  sheetsService: GoogleSheetsService
): Promise<EmailService> {
  // Get required environment variables
  const config = getEmailConfig();

  // Create email service
  return new EmailService(
    config.apiKey,
    config.fromEmail,
    config.fromName,
    sheetsService
  );
}

function getEmailConfig(): EmailConfig {
  const apiKey = process.env.SENDGRID_API_KEY;
  const fromEmail = process.env.EMAIL_FROM_ADDRESS;
  const fromName = process.env.EMAIL_FROM_NAME;

  if (!apiKey || !fromEmail || !fromName) {
    throw new Error('Missing required email configuration environment variables');
  }

  return {
    apiKey,
    fromEmail,
    fromName
  };
}