import { Resend } from "resend";

const RECIPIENT = "todd@pmcdecor.com";
const DEFAULT_FROM = "Analytics <notifications@pmcdecor.com>";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export async function notifyMissingProjectManager(params: {
  companyId: string;
  projectId: string;
  projectNumber: string | null;
  projectName: string;
  taskTitle: string;
  workflowKey: string;
  details?: string[];
}) {
  const apiKey = String(process.env.RESEND_API_KEY || "").trim();
  if (!apiKey) throw new Error("RESEND_API_KEY is not configured.");
  const from = String(
    process.env.TASK_ALERT_FROM_EMAIL
    || process.env.RESEND_FROM_EMAIL
    || DEFAULT_FROM,
  ).trim();
  const projectLabel = [params.projectNumber, params.projectName]
    .filter((value) => Boolean(String(value || "").trim()))
    .join(" - ") || params.projectId;
  const projectUrl = `https://us02.procore.com/${encodeURIComponent(params.projectId)}/project/home`;
  const detailLines = (params.details || []).filter(Boolean);
  const text = [
    `Analytics did not create the "${params.taskTitle}" task because no active Project Manager with an @pmcdecor.com email is assigned to this project.`,
    "",
    `Project: ${projectLabel}`,
    ...detailLines,
    `Procore: ${projectUrl}`,
  ].join("\n");
  const htmlDetails = detailLines.map((line) => `<li>${escapeHtml(line)}</li>`).join("");
  const result = await new Resend(apiKey).emails.send({
    from,
    to: [RECIPIENT],
    subject: `[Analytics] Project Manager needed - ${projectLabel}`,
    text,
    html: [
      `<p>Analytics did not create the <strong>${escapeHtml(params.taskTitle)}</strong> task because no active Project Manager with an <code>@pmcdecor.com</code> email is assigned to this project.</p>`,
      `<ul><li>Project: ${escapeHtml(projectLabel)}</li>${htmlDetails}</ul>`,
      `<p><a href="${escapeHtml(projectUrl)}">Open project in Procore</a></p>`,
    ].join(""),
  }, {
    idempotencyKey: `pmc-missing-pm-${params.companyId}-${params.projectId}-${params.workflowKey}`,
  });
  if (result.error) throw new Error(result.error.message);
  return { recipient: RECIPIENT, messageId: result.data?.id || null };
}