const SAFE_HTTP_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export type CsrfRequestMetadata = {
  method: string;
  requestUrl: string;
  origin?: string | null;
  referer?: string | null;
};

export type CsrfValidationResult =
  | { allowed: true }
  | { allowed: false; reason: 'missing-source' | 'invalid-source' | 'cross-origin' };

function parseOrigin(value: string): string | null {
  try {
    return new URL(value).origin.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Protect cookie-authenticated state changes by requiring the browser-reported
 * source to match the application origin. This works when the app is embedded
 * in Procore because requests made by the embedded Analytics page still carry
 * the Analytics origin.
 */
export function validateCsrfRequest(metadata: CsrfRequestMetadata): CsrfValidationResult {
  if (SAFE_HTTP_METHODS.has(metadata.method.toUpperCase())) {
    return { allowed: true };
  }

  const requestOrigin = parseOrigin(metadata.requestUrl);
  if (!requestOrigin) {
    return { allowed: false, reason: 'invalid-source' };
  }

  const sourceValue = metadata.origin?.trim() || metadata.referer?.trim();
  if (!sourceValue) {
    return { allowed: false, reason: 'missing-source' };
  }

  const sourceOrigin = parseOrigin(sourceValue);
  if (!sourceOrigin) {
    return { allowed: false, reason: 'invalid-source' };
  }

  if (sourceOrigin !== requestOrigin) {
    return { allowed: false, reason: 'cross-origin' };
  }

  return { allowed: true };
}
