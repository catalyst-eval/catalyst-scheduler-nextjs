// src/lib/google/auth.ts

import { JWT } from 'google-auth-library';
import { GoogleSheetsService } from './sheets';

export function getGoogleAuthCredentials() {
  try {
    // Ensure all required environment variables are present
    const privateKey = process.env.GOOGLE_SHEETS_PRIVATE_KEY;
    const clientEmail = process.env.GOOGLE_SHEETS_CLIENT_EMAIL;
    
    console.log('Environment variables check:', {
      hasPrivateKey: !!privateKey,
      privateKeyLength: privateKey?.length,
      hasClientEmail: !!clientEmail,
      spreadsheetId: process.env.GOOGLE_SHEETS_SPREADSHEET_ID
    });

    if (!privateKey || !clientEmail) {
      throw new Error('Missing required Google authentication environment variables');
    }

    // Create credentials object
    return {
      private_key: privateKey.replace(/\\n/g, '\n'), // Handle escaped newlines
      client_email: clientEmail
    };
  } catch (error) {
    console.error('Error in getGoogleAuthCredentials:', error);
    throw error;
  }
}

export function createGoogleAuthClient() {
  try {
    const credentials = getGoogleAuthCredentials();
    
    console.log('Creating JWT client with scopes');
    
    return new JWT({
      email: credentials.client_email,
      key: credentials.private_key,
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });
  } catch (error) {
    console.error('Error in createGoogleAuthClient:', error);
    throw error;
  }
}

// Helper to initialize sheets service with authentication
export async function initializeGoogleSheets() {
  try {
    console.log('Starting Google Sheets initialization');
    
    const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
    
    if (!spreadsheetId) {
      throw new Error('Missing Google Sheets spreadsheet ID');
    }

    const credentials = getGoogleAuthCredentials();
    console.log('Got credentials, creating service');
    
    const sheetsService = new GoogleSheetsService(credentials, spreadsheetId);
    
    console.log('Testing connection with getOffices');
    // Test the connection
    await sheetsService.getOffices();
    
    console.log('Successfully connected to Google Sheets');
    return sheetsService;
  } catch (error) {
    console.error('Detailed initialization error:', error);
    throw new Error('Google Sheets service initialization failed');
  }
}