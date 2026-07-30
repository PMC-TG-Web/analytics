export type ProductivityReviewEmailInput = {
  projectId: string;
  projectNumber: string | null;
  projectName: string;
  reviewerEmail: string;
  reviewedAt: Date;
  weightedCompletion: number | null;
  recipientEmail: string;
  projectUrl: string;
};

export type ProductivityReadyEmailInput = {
  projectNumber: string | null;
  projectName: string;
  completedAt: Date;
  eligibleAt: Date;
  projectUrl: string;
};

export type ProductivityCompleteEmailInput = {
  projectNumber: string | null;
  projectName: string;
  completedAt: Date;
  eligibleAt: Date;
  projectUrl: string;
};

export function isValidNotificationEmail(value: string): boolean {
  const email = value.trim();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatPercent(ratio: number | null): string {
  if (ratio === null || !Number.isFinite(ratio)) return "Not available";
  return `${(ratio * 100).toFixed(1)}%`;
}

export function buildProductivityReviewEmail(input: ProductivityReviewEmailInput) {
  const projectLabel = [input.projectNumber, input.projectName]
    .filter(Boolean)
    .join(" · ")
    .replace(/[\r\n]+/g, " ");
  const reviewedAt = input.reviewedAt.toLocaleString("en-US", {
    timeZone: "America/New_York",
    dateStyle: "medium",
    timeStyle: "short",
  });
  const completion = formatPercent(input.weightedCompletion);
  const subject = `Field Productivity reviewed — ${projectLabel}`;
  const text = [
    `${projectLabel} has been reviewed and marked complete.`,
    "",
    `Reviewed by: ${input.reviewerEmail}`,
    `Reviewed at: ${reviewedAt} ET`,
    `Weighted completion: ${completion}`,
    "",
    `Open project: ${input.projectUrl}`,
  ].join("\n");
  const html = `
    <div style="background:#f1f5f9;padding:24px;font-family:Arial,sans-serif;color:#0f172a">
      <div style="max-width:620px;margin:0 auto;background:#fff;border:1px solid #cbd5e1;border-radius:12px;overflow:hidden">
        <div style="background:#1e293b;padding:20px 24px;color:#fff">
          <div style="font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#99f6e4">Field Productivity</div>
          <h1 style="font-size:22px;margin:8px 0 0">Project review complete</h1>
        </div>
        <div style="padding:24px">
          <h2 style="font-size:18px;margin:0 0 18px">${escapeHtml(projectLabel)}</h2>
          <table role="presentation" style="width:100%;border-collapse:collapse;font-size:14px">
            <tr><td style="padding:8px 0;color:#64748b">Reviewed by</td><td style="padding:8px 0;text-align:right;font-weight:700">${escapeHtml(input.reviewerEmail)}</td></tr>
            <tr><td style="padding:8px 0;color:#64748b">Reviewed at</td><td style="padding:8px 0;text-align:right;font-weight:700">${escapeHtml(reviewedAt)} ET</td></tr>
            <tr><td style="padding:8px 0;color:#64748b">Weighted completion</td><td style="padding:8px 0;text-align:right;font-weight:700">${escapeHtml(completion)}</td></tr>
          </table>
          <a href="${escapeHtml(input.projectUrl)}" style="display:inline-block;margin-top:22px;background:#0f766e;color:#fff;text-decoration:none;font-weight:700;padding:11px 16px;border-radius:8px">Open Field Productivity</a>
        </div>
      </div>
    </div>
  `.trim();

  return { subject, text, html };
}

export function buildProductivityReadyEmail(input: ProductivityReadyEmailInput) {
  const projectLabel = [input.projectNumber, input.projectName]
    .filter(Boolean)
    .join(" · ")
    .replace(/[\r\n]+/g, " ");
  const completedAt = input.completedAt.toLocaleDateString("en-US", {
    timeZone: "America/New_York",
    dateStyle: "medium",
  });
  const eligibleAt = input.eligibleAt.toLocaleDateString("en-US", {
    timeZone: "America/New_York",
    dateStyle: "medium",
  });
  const subject = `Field Productivity ready for review — ${projectLabel}`;
  const text = [
    `${projectLabel} is ready for its Field Productivity review.`,
    "",
    `Bid Board marked Complete: ${completedAt}`,
    `30-day review date: ${eligibleAt}`,
    "",
    `Open project: ${input.projectUrl}`,
  ].join("\n");
  const html = `
    <div style="background:#f1f5f9;padding:24px;font-family:Arial,sans-serif;color:#0f172a">
      <div style="max-width:620px;margin:0 auto;background:#fff;border:1px solid #cbd5e1;border-radius:12px;overflow:hidden">
        <div style="background:#1e293b;padding:20px 24px;color:#fff">
          <div style="font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#99f6e4">Field Productivity</div>
          <h1 style="font-size:22px;margin:8px 0 0">Project ready for review</h1>
        </div>
        <div style="padding:24px">
          <h2 style="font-size:18px;margin:0 0 18px">${escapeHtml(projectLabel)}</h2>
          <p style="font-size:14px;line-height:1.5">The 30-day cooldown has finished. This project can now be reviewed and marked complete in Field Productivity.</p>
          <table role="presentation" style="width:100%;border-collapse:collapse;font-size:14px">
            <tr><td style="padding:8px 0;color:#64748b">Bid Board marked Complete</td><td style="padding:8px 0;text-align:right;font-weight:700">${escapeHtml(completedAt)}</td></tr>
            <tr><td style="padding:8px 0;color:#64748b">Eligible for review</td><td style="padding:8px 0;text-align:right;font-weight:700">${escapeHtml(eligibleAt)}</td></tr>
          </table>
          <a href="${escapeHtml(input.projectUrl)}" style="display:inline-block;margin-top:22px;background:#0f766e;color:#fff;text-decoration:none;font-weight:700;padding:11px 16px;border-radius:8px">Review Field Productivity</a>
        </div>
      </div>
    </div>
  `.trim();
  return { subject, text, html };
}

export function buildProductivityCompleteEmail(input: ProductivityCompleteEmailInput) {
  const projectLabel = [input.projectNumber, input.projectName]
    .filter(Boolean)
    .join(" · ")
    .replace(/[\r\n]+/g, " ");
  const completedAt = input.completedAt.toLocaleString("en-US", {
    timeZone: "America/New_York",
    dateStyle: "medium",
    timeStyle: "short",
  });
  const eligibleAt = input.eligibleAt.toLocaleDateString("en-US", {
    timeZone: "America/New_York",
    dateStyle: "medium",
  });
  const subject = `Project marked Complete — ${projectLabel}`;
  const text = [
    `${projectLabel} was marked Complete on the Procore Bid Board.`,
    "",
    `Status changed: ${completedAt} ET`,
    `Field Productivity review date: ${eligibleAt}`,
    "",
    `Open project: ${input.projectUrl}`,
  ].join("\n");
  const html = `
    <div style="background:#f1f5f9;padding:24px;font-family:Arial,sans-serif;color:#0f172a">
      <div style="max-width:620px;margin:0 auto;background:#fff;border:1px solid #cbd5e1;border-radius:12px;overflow:hidden">
        <div style="background:#1e293b;padding:20px 24px;color:#fff">
          <div style="font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#99f6e4">Procore Bid Board</div>
          <h1 style="font-size:22px;margin:8px 0 0">Project marked Complete</h1>
        </div>
        <div style="padding:24px">
          <h2 style="font-size:18px;margin:0 0 18px">${escapeHtml(projectLabel)}</h2>
          <table role="presentation" style="width:100%;border-collapse:collapse;font-size:14px">
            <tr><td style="padding:8px 0;color:#64748b">Status changed</td><td style="padding:8px 0;text-align:right;font-weight:700">${escapeHtml(completedAt)} ET</td></tr>
            <tr><td style="padding:8px 0;color:#64748b">Field Productivity review</td><td style="padding:8px 0;text-align:right;font-weight:700">${escapeHtml(eligibleAt)}</td></tr>
          </table>
          <a href="${escapeHtml(input.projectUrl)}" style="display:inline-block;margin-top:22px;background:#0f766e;color:#fff;text-decoration:none;font-weight:700;padding:11px 16px;border-radius:8px">Open Field Productivity</a>
        </div>
      </div>
    </div>
  `.trim();
  return { subject, text, html };
}
