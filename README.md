# Catalyst Scheduler

A therapy practice scheduling system with intelligent office assignment and IntakeQ integration.

## Project Overview
Primary Technology Stack:
- Next.js 14
- IntakeQ API Integration
- Google Sheets Integration
- TypeScript & Tailwind CSS

## Environment Setup

Create a `.env.local` file with the following variables:
GOOGLE_SHEETS_PRIVATE_KEY=
GOOGLE_SHEETS_CLIENT_EMAIL=
GOOGLE_SHEETS_SPREADSHEET_ID=
INTAKEQ_API_KEY=
INTAKEQ_WEBHOOK_SECRET=
SENDGRID_API_KEY=
EMAIL_FROM_ADDRESS=
EMAIL_FROM_NAME=
Copy
## Development

```bash
# Install dependencies
npm install

# Run the development server
npm run dev
Copy
## 2. Rename env.example to .env.example:

```bash
mv env.example .env.example