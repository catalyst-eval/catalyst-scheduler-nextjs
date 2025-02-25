// test-simple-webhook.js
const express = require('express');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
const port = 3002;

// Simple middleware to capture raw body
app.use((req, res, next) => {
  let data = '';
  
  req.on('data', chunk => {
    data += chunk.toString();
    console.log('Received chunk:', chunk.toString());
  });
  
  req.on('end', () => {
    req.rawBody = data;
    console.log('Raw body captured:', data);
    
    // Parse JSON if it's a JSON request
    if (req.headers['content-type'] === 'application/json') {
      try {
        req.body = JSON.parse(data);
        console.log('Parsed body:', req.body);
      } catch (e) {
        console.error('Failed to parse JSON:', e);
      }
    }
    
    next();
  });
});

// Signature verification endpoint
app.post('/webhook', (req, res) => {
  console.log('Headers:', req.headers);
  console.log('Raw Body:', req.rawBody);
  
  const signature = req.headers['x-intakeq-signature'];
  if (!signature) {
    return res.status(401).json({ error: 'Missing signature' });
  }
  
  const secret = process.env.INTAKEQ_WEBHOOK_SECRET;
  if (!secret) {
    return res.status(500).json({ error: 'Missing webhook secret' });
  }
  
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(req.rawBody);
  const calculatedSignature = hmac.digest('hex');
  
  console.log('Calculated signature:', calculatedSignature);
  console.log('Provided signature:', signature);
  console.log('Signatures match:', calculatedSignature === signature);
  
  if (calculatedSignature !== signature) {
    return res.status(401).json({ error: 'Invalid signature' });
  }
  
  res.json({ success: true, message: 'Webhook received and verified' });
});

app.listen(port, () => {
  console.log(`Test server running at http://localhost:${port}`);
  console.log(`INTAKEQ_WEBHOOK_SECRET configured:`, !!process.env.INTAKEQ_WEBHOOK_SECRET);
});