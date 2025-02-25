#!/bin/bash
# Deploy to Vercel with proper environment variables

# Function to clean private key
clean_private_key() {
  echo "$1" | sed 's/\\n/\n/g'
}

# Ensure environment variables are set
if [ -f .env.local ]; then
  source .env.local
else
  echo "Error: .env.local file not found"
  exit 1
fi

# Clean and set private key
CLEANED_KEY=$(clean_private_key "$GOOGLE_SHEETS_PRIVATE_KEY")

# Deploy with Vercel CLI
vercel \
  -e GOOGLE_SHEETS_PRIVATE_KEY="$CLEANED_KEY" \
  -e GOOGLE_SHEETS_CLIENT_EMAIL="$GOOGLE_SHEETS_CLIENT_EMAIL" \
  -e GOOGLE_SHEETS_SPREADSHEET_ID="$GOOGLE_SHEETS_SPREADSHEET_ID" \
  -e INTAKEQ_API_KEY="$INTAKEQ_API_KEY" \
  -e INTAKEQ_WEBHOOK_SECRET="$INTAKEQ_WEBHOOK_SECRET" \
  -e SENDGRID_API_KEY="$SENDGRID_API_KEY" \
  -e EMAIL_FROM_ADDRESS="$EMAIL_FROM_ADDRESS" \
  -e EMAIL_FROM_NAME="$EMAIL_FROM_NAME" \
  --prod

