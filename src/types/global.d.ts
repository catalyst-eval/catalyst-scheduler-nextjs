declare global {
    namespace NodeJS {
      interface ProcessEnv {
        GOOGLE_SHEETS_PRIVATE_KEY: string;
        GOOGLE_SHEETS_CLIENT_EMAIL: string;
        GOOGLE_SHEETS_SPREADSHEET_ID: string;
      }
    }
  }
  
  // Ensure this is treated as a module
  export {};