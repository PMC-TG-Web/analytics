import { isValidNotificationEmail } from "@/lib/productivityReviewEmail";

export const DEFAULT_PRODUCTIVITY_REVIEW_FROM_EMAIL =
  "Field Productivity <notifications@pmcdecor.com>";
export const DEFAULT_PRODUCTIVITY_REVIEW_TO_EMAILS = [
  "projectend@pmcdecor.com",
];

export function getProductivityReviewNotificationConfig() {
  const from = String(
    process.env.PRODUCTIVITY_REVIEW_FROM_EMAIL
    || process.env.RESEND_FROM_EMAIL
    || DEFAULT_PRODUCTIVITY_REVIEW_FROM_EMAIL,
  ).trim();
  const configuredRecipients = String(
    process.env.PRODUCTIVITY_REVIEW_TO_EMAILS
    || DEFAULT_PRODUCTIVITY_REVIEW_TO_EMAILS.join(","),
  );
  const to = [...new Set(
    configuredRecipients
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  )];
  if (!to.length || to.some((email) => !isValidNotificationEmail(email))) {
    throw new Error("PRODUCTIVITY_REVIEW_TO_EMAILS is not configured correctly.");
  }
  return {
    apiKey: String(process.env.RESEND_API_KEY || "").trim(),
    from,
    to,
  };
}
