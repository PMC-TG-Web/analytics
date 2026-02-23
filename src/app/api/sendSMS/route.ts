import { NextRequest, NextResponse } from 'next/server';
import twilio from 'twilio';

// Initialize Twilio client
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const twilioPhoneNumber = process.env.TWILIO_PHONE_NUMBER;

export async function POST(req: NextRequest) {
  try {
    // Validate Twilio credentials
    if (!accountSid || !authToken || !twilioPhoneNumber) {
      return NextResponse.json(
        { error: 'Twilio credentials not configured. Please set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER in .env.local' },
        { status: 500 }
      );
    }

    const body = await req.json();
    const { to, message } = body;

    // Validate required fields
    if (!to || !message) {
      return NextResponse.json(
        { error: 'Missing required fields: to (phone number) and message' },
        { status: 400 }
      );
    }

    // Validate phone number format (basic check)
    const phoneRegex = /^\+?1?[0-9]{10,15}$/;
    if (!phoneRegex.test(to.replace(/[\s\-\(\)]/g, ''))) {
      return NextResponse.json(
        { error: 'Invalid phone number format. Use format: +1234567890 or 1234567890' },
        { status: 400 }
      );
    }

    // Initialize Twilio client
    const client = twilio(accountSid, authToken);

    // Send SMS
    const smsResult = await client.messages.create({
      body: message,
      from: twilioPhoneNumber,
      to: to.replace(/[\s\-\(\)]/g, ''), // Clean phone number
    });

    return NextResponse.json({
      success: true,
      messageId: smsResult.sid,
      status: smsResult.status,
      to: smsResult.to,
    });

  } catch (error) {
    console.error('Error sending SMS:', error);
    
    return NextResponse.json(
      { 
        error: 'Failed to send SMS', 
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
