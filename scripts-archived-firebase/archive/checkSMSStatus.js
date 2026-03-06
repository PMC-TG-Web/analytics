/**
 * Check SMS message status from Twilio
 * Usage: node scripts/checkSMSStatus.js SM36c27eb35fbec0c576604fb46f50a2a2
 */

require('dotenv').config({ path: '.env.local' });
const twilio = require('twilio');

async function checkStatus() {
  const messageId = process.argv[2] || 'SM36c27eb35fbec0c576604fb46f50a2a2';

  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
    console.error('❌ Missing Twilio credentials');
    process.exit(1);
  }

  const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

  try {
    console.log(`\n🔍 Checking status for message: ${messageId}\n`);
    
    const message = await client.messages(messageId).fetch();

    console.log('Status:', message.status);
    console.log('To:', message.to);
    console.log('From:', message.from);
    console.log('Date Sent:', message.dateSent);
    console.log('Date Updated:', message.dateUpdated);
    console.log('Error Code:', message.errorCode || 'None');
    console.log('Error Message:', message.errorMessage || 'None');
    console.log('Price:', message.price || 'Pending');
    console.log('Direction:', message.direction);
    
    if (message.status === 'failed' || message.status === 'undelivered') {
      console.log('\n❌ Message failed!');
      if (message.errorCode) {
        console.log(`\nError ${message.errorCode}: ${message.errorMessage}`);
        console.log('\nCommon causes:');
        console.log('- Trial account: Can only send to verified numbers');
        console.log('- Invalid phone number format');
        console.log('- Carrier blocking the message');
      }
    } else if (message.status === 'delivered') {
      console.log('\n✅ Message delivered successfully!');
    } else if (message.status === 'sent' || message.status === 'queued') {
      console.log('\n⏳ Message is still being processed...');
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

checkStatus();
