import dotenv from 'dotenv';
dotenv.config();

console.log('Loaded environment variables:');
console.log('GOOGLE_SHEETS_PRIVATE_KEY:', process.env.GOOGLE_SHEETS_PRIVATE_KEY ? 'Value exists (hidden)' : 'MISSING');
console.log('GOOGLE_SHEETS_CLIENT_EMAIL:', process.env.GOOGLE_SHEETS_CLIENT_EMAIL ? process.env.GOOGLE_SHEETS_CLIENT_EMAIL : 'MISSING');
console.log('GOOGLE_SHEETS_SPREADSHEET_ID:', process.env.GOOGLE_SHEETS_SPREADSHEET_ID ? process.env.GOOGLE_SHEETS_SPREADSHEET_ID : 'MISSING');
