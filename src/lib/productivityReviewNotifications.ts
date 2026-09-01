import { isValidNotificationEmail } from "@/lib/productivityReviewEmail";
import { parsePmcdecorEmailList } from "@/lib/timecardNotification";

export const DEFAULT_PRODUCTIVITY_REVIEW_FROM_EMAIL =
  "Field Productivity <notifications@pmcdecor.com>";
export const DEFAULT_PRODUCTIVITY_REVIEW_TO_EMAILS = [
  "projectend@pmcdecor.com",
];
export const DEFAULT_PRODUCTIVITY_COMPLETE_TO_EMAILS = [
  "todd@pmcdecor.com",
];

function getNotificationConfig(params: {
  recipients: string | undefined;
  defaults: string[];
  environmentName: string;
}) {
  const from = String(
    process.env.PRODUCTIVITY_REVIEW_FROM_EMAIL
    || process.env.RESEND_FROM_EMAIL
    || DEFAULT_PRODUCTIVITY_REVIEW_FROM_EMAIL,
  ).trim();
  const configuredRecipients = String(
    params.recipients
    || params.defaults.join(","),
  );
  const to = parsePmcdecorEmailList(configuredRecipients);
  if (to.some((email) => !isValidNotificationEmail(email))) {
    throw new Error(`${params.environmentName} is not configured correctly.`);
  }
  return {
    apiKey: String(process.env.RESEND_API_KEY || "").trim(),
    from,
    to,
  };
}

export function getProductivityReviewNotificationConfig() {
  return getNotificationConfig({
    recipients: process.env.PRODUCTIVITY_REVIEW_TO_EMAILS,
    defaults: DEFAULT_PRODUCTIVITY_REVIEW_TO_EMAILS,
    environmentName: "PRODUCTIVITY_REVIEW_TO_EMAILS",
  });
}

export function getProductivityCompleteNotificationConfig() {
  return getNotificationConfig({
    recipients: process.env.PRODUCTIVITY_COMPLETE_TO_EMAILS,
    defaults: DEFAULT_PRODUCTIVITY_COMPLETE_TO_EMAILS,
    environmentName: "PRODUCTIVITY_COMPLETE_TO_EMAILS",
  });
}
