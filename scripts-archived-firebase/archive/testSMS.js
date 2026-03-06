/**
 * Test script for Twilio SMS functionality
 * 
 * Usage:
 *   node scripts/testSMS.js +15551234567 "Your test message"
 * 
 * Make sure to set up your Twilio credentials in .env.local first:
 *   TWILIO_ACCOUNT_SID
 *   TWILIO_AUTH_TOKEN
 *   TWILIO_PHONE_NUMBER
 */

require('dotenv').config({ path: '.env.local' });

async function testSMS() {
  // Get command line arguments
  const phoneNumber = process.argv[2];
  const message = process.argv[3] || 'Test message from PMC Analytics';

  if (!phoneNumber) {
    console.error('❌ Error: Phone number is required');
    console.log('\nUsage:');
    console.log('  node scripts/testSMS.js +15551234567 "Your test message"');
    console.log('\nExamples:');
    console.log('  node scripts/testSMS.js +15555551234 "Test message"');
    console.log('  node scripts/testSMS.js 5555551234 "Hello from PMC"');
    process.exit(1);
  }

  // Check environment variables
  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN || !process.env.TWILIO_PHONE_NUMBER) {
    console.error('❌ Error: Missing Twilio credentials in .env.local');
    console.log('\nPlease set these environment variables:');
    console.log('  TWILIO_ACCOUNT_SID=your_account_sid');
    console.log('  TWILIO_AUTH_TOKEN=your_auth_token');
    console.log('  TWILIO_PHONE_NUMBER=+15551234567');
    console.log('\nGet your credentials from: https://console.twilio.com');
    process.exit(1);
  }

  console.log('\n📱 Sending SMS...');
  console.log('To:', phoneNumber);
  console.log('Message:', message);
  console.log('From:', process.env.TWILIO_PHONE_NUMBER);

  try {
    // Call the API endpoint
    const response = await fetch('http://localhost:3000/api/sendSMS', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to: phoneNumber,
        message: message,
      }),
    });

    const result = await response.json();

    if (response.ok) {
      console.log('\n✅ SMS sent successfully!');
      console.log('Message ID:', result.messageId);
      console.log('Status:', result.status);
      console.log('To:', result.to);
    } else {
      console.error('\n❌ Failed to send SMS');
      console.error('Error:', result.error);
      if (result.details) {
        console.error('Details:', result.details);
      }
    }
  } catch (error) {
    console.error('\n❌ Error testing SMS:', error.message);
    console.log('\nMake sure:');
    console.log('1. Next.js dev server is running (npm run dev)');
    console.log('2. Twilio credentials are set in .env.local');
    console.log('3. Phone number format is correct (+15551234567)');
  }
}

testSMS();
