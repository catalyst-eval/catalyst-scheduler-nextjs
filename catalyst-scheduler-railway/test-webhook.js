// test-webhook.js
const crypto = require('crypto');
require('dotenv').config();

// Sample payload similar to what IntakeQ would send
const payload = JSON.stringify({
  Type: "Appointment Created",
  ClientId: 123,
  Appointment: {
    Id: "test-1",
    ClientName: "Test Client",
    ClientEmail: "test@example.com",
    StartDateIso: "2023-08-01T14:00:00Z",
    EndDateIso: "2023-08-01T15:00:00Z",
    PractitionerId: "pract-1"
  }
});

// Create valid signature with your webhook secret
const secret = process.env.INTAKEQ_WEBHOOK_SECRET;
const hmac = crypto.createHmac('sha256', secret);
hmac.update(payload);
const signature = hmac.digest('hex');

console.log('Test payload:', payload);
console.log('Signature:', signature);
console.log('\nCommand to test:');
console.log(`curl -X POST http://localhost:3001/api/webhooks/intakeq \\
  -H "Content-Type: application/json" \\
  -H "X-IntakeQ-Signature: ${signature}" \\
  -d '${payload}'`);