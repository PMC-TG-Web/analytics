import { Resend } from 'resend';
import twilio from 'twilio';
import { NextResponse } from 'next/server';

export const runtime = "nodejs";

function normalizePhone(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("+")) return trimmed;
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

export async function POST(request: Request) {
  try {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      console.error("CRITICAL: RESEND_API_KEY is missing from environment variables.");
      return NextResponse.json({ error: "Email service is not configured (Missing API Key)." }, { status: 500 });
    }

    const resend = new Resend(apiKey);
    const body = await request.json();
    const { employeeName, reason, notes, recipients, recipientPhones, reportedBy } = body;

    const { data, error } = await resend.emails.send({
      from: 'PMC Dispatch <dispatch@pmcdecor.com>',
      to: recipients,
      subject: `Absence Alert: ${employeeName} (${reason})`,
      html: `
        <div style="font-family: sans-serif; padding: 20px; border: 1px solid #eee; border-radius: 8px;">
          <h2 style="color: #15616D; border-bottom: 2px solid #15616D; padding-bottom: 10px;">Employee Absence Report</h2>
          <p><strong>Employee:</strong> ${employeeName}</p>
          <p><strong>Reason:</strong> ${reason}</p>
          <p><strong>Notes:</strong> ${notes || 'No additional notes provided.'}</p>
          <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />
          <p style="font-size: 12px; color: #666;">Reported by ${reportedBy} via Crew Dispatch Board at ${new Date().toLocaleString()}</p>
        </div>
      `,
    });

    if (error) {
      return NextResponse.json({ error }, { status: 400 });
    }

    const sms: { sent: number; error?: string } = { sent: 0 };
    if (Array.isArray(recipientPhones) && recipientPhones.length > 0) {
      const accountSid = process.env.TWILIO_ACCOUNT_SID;
      const authToken = process.env.TWILIO_AUTH_TOKEN;
      const fromNumber = process.env.TWILIO_FROM_NUMBER;

      if (!accountSid || !authToken || !fromNumber) {
        sms.error = "Missing Twilio configuration.";
      } else {
        const client = twilio(accountSid, authToken);
        const uniquePhones = Array.from(new Set(
          recipientPhones
            .map((phone: string) => normalizePhone(phone))
            .filter((phone): phone is string => !!phone)
        ));

        if (uniquePhones.length === 0) {
          sms.error = "No valid phone numbers found.";
        } else {
          const messageText = `Absence Alert: ${employeeName} (${reason}). Notes: ${notes || "None"}. Reported by ${reportedBy}.`;
          const results = await Promise.allSettled(
            uniquePhones.map((to) =>
              client.messages.create({
                from: fromNumber,
                to,
                body: messageText,
              })
            )
          );

          sms.sent = results.filter(result => result.status === "fulfilled").length;
          const failed = results.filter(result => result.status === "rejected");
          if (failed.length > 0) {
            sms.error = `Failed to send ${failed.length} text message${failed.length > 1 ? "s" : ""}.`;
          }
        }
      }
    }

    return NextResponse.json({ data, sms });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
