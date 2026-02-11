import { Resend } from 'resend';
import { NextResponse } from 'next/server';

const resend = new Resend(process.env.RESEND_API_KEY);

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { employeeName, reason, notes, recipients, reportedBy } = body;

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

    return NextResponse.json({ data });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
