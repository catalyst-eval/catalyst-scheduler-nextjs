// test-signature.js
const crypto = require('crypto');
require('dotenv').config();

const payload = JSON.stringify({
  Type: "Appointment Created",
  ClientId: 123,
  Appointment: {
    Id: "test-1",
    ClientName: "Test Client",
    StartDateIso: "2023-08-01T14:00:00Z",
    EndDateIso: "2023-08-01T15:00:00Z"
  }
});

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