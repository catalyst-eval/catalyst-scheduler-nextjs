import { JWT } from 'google-auth-library';
import { GoogleSheetsService } from './sheets';

export function getGoogleAuthCredentials() {
  try {
    // Get raw environment variables
    const rawKey = process.env.GOOGLE_SHEETS_PRIVATE_KEY;
    const clientEmail = process.env.GOOGLE_SHEETS_CLIENT_EMAIL;
    const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;

    // Validate presence
    if (!rawKey || !clientEmail || !spreadsheetId) {
      throw new Error('Missing required Google authentication environment variables');
    }

    // Clean and format private key - updated handling
    const privateKey = rawKey.split(String.raw`\n`).join('\n');

    // Validate key format
    if (!privateKey.includes('BEGIN PRIVATE KEY') || !privateKey.includes('END PRIVATE KEY')) {
      throw new Error('Invalid Google Sheets private key format');
    }

    // Validate email format
    if (!clientEmail.includes('@') || !clientEmail.includes('.iam.gserviceaccount.com')) {
      throw new Error('Invalid service account email format');
    }

    console.log('Credentials validation:', {
      hasValidKey: privateKey.includes('BEGIN PRIVATE KEY'),
      hasValidEmail: clientEmail.includes('@'),
      hasSpreadsheetId: !!spreadsheetId
    });

    return {
      private_key: privateKey,
      client_email: clientEmail,
      spreadsheetId
    };
  } catch (error: unknown) {
    console.error('Credentials error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    throw new Error(`Google authentication configuration error: ${errorMessage}`);
  }
}

export function createGoogleAuthClient() {
  const credentials = getGoogleAuthCredentials();
  
  return new JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });
}

export async function initializeGoogleSheets(): Promise<GoogleSheetsService> {
  try {
    console.log('Starting Google Sheets initialization');
    
    const credentials = getGoogleAuthCredentials();
    console.log('Got credentials, creating service');
    
    const sheetsService = new GoogleSheetsService(credentials, credentials.spreadsheetId);
    
    // Validate connection by attempting to read a small range
    console.log('Testing connection with getOffices');
    await sheetsService.getOffices();
    
    console.log('Google Sheets service initialized successfully');
    return sheetsService;
    
  } catch (error: unknown) {
    console.error('Detailed initialization error:', error);
    throw new Error('Google Sheets service initialization failed');
  }
}