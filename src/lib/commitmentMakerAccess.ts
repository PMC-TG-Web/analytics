const TOKEN_CONTEXT = "pmc-commitment-maker-project-link-v1";

export const COMMITMENT_MAKER_ACCESS_HEADER = "x-commitment-maker-access";
export const COMMITMENT_MAKER_PROJECT_HEADER = "x-commitment-maker-project-id";

function configuredSecret(): string {
  const secret = String(
    process.env.COMMITMENT_MAKER_LINK_SECRET ||
    process.env.PROCORE_SYNC_SECRET ||
    process.env.CRON_SECRET ||
    "",
  ).trim();
  if (!secret) throw new Error("Commitment Maker project-link signing is not configured.");
  return secret;
}

function normalizedProjectId(value: unknown): string {
  const projectId = String(value || "").trim();
  return /^\d+$/.test(projectId) ? projectId : "";
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function signature(projectId: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signed = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`${TOKEN_CONTEXT}:${projectId}`),
  );
  return base64Url(new Uint8Array(signed));
}

function constantTimeEqual(left: string, right: string): boolean {
  const length = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}

export async function createCommitmentMakerAccessToken(
  projectIdValue: unknown,
  secret = configuredSecret(),
): Promise<string> {
  const projectId = normalizedProjectId(projectIdValue);
  if (!projectId) throw new Error("A numeric Procore project ID is required for Commitment Maker access.");
  return signature(projectId, secret);
}

export async function verifyCommitmentMakerAccessToken(
  projectIdValue: unknown,
  tokenValue: unknown,
  secret = configuredSecret(),
): Promise<boolean> {
  const projectId = normalizedProjectId(projectIdValue);
  const token = String(tokenValue || "").trim();
  if (!projectId || !/^[A-Za-z0-9_-]{43}$/.test(token)) return false;
  const expected = await signature(projectId, secret);
  return constantTimeEqual(expected, token);
}
