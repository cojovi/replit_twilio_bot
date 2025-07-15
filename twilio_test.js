// Test Twilio configuration
const twilio = require('twilio');

async function testTwilio() {
  try {
    console.log('Testing Twilio configuration...');
    
    // Check environment variables
    console.log('TWILIO_ACCOUNT_SID:', process.env.TWILIO_ACCOUNT_SID ? 'Set' : 'Missing');
    console.log('TWILIO_AUTH_TOKEN:', process.env.TWILIO_AUTH_TOKEN ? 'Set' : 'Missing');
    console.log('TWILIO_PHONE_NUMBER:', process.env.TWILIO_PHONE_NUMBER);
    
    // Initialize client
    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    
    // Test account info
    const account = await client.api.accounts(process.env.TWILIO_ACCOUNT_SID).fetch();
    console.log('Account status:', account.status);
    console.log('Account type:', account.type);
    
    // List recent calls
    const calls = await client.calls.list({ limit: 5 });
    console.log('Recent calls:', calls.length);
    calls.forEach(call => {
      console.log(`- ${call.sid}: ${call.to} (${call.status})`);
    });
    
    // Test phone number
    const phoneNumbers = await client.incomingPhoneNumbers.list({ limit: 10 });
    console.log('Phone numbers:', phoneNumbers.length);
    phoneNumbers.forEach(num => {
      console.log(`- ${num.phoneNumber} (${num.capabilities.voice ? 'voice' : 'no voice'})`);
    });
    
  } catch (error) {
    console.error('Twilio test failed:', error);
  }
}

testTwilio();