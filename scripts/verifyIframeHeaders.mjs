#!/usr/bin/env node

const inputUrl = process.argv[2] || process.env.VERIFY_URL || process.env.APP_BASE_URL;

if (!inputUrl) {
  console.error('Usage: node scripts/verifyIframeHeaders.mjs <url>');
  console.error('Or set VERIFY_URL / APP_BASE_URL in env.');
  process.exit(1);
}

let target;
try {
  target = new URL(inputUrl);
} catch {
  console.error(`Invalid URL: ${inputUrl}`);
  process.exit(1);
}

const response = await fetch(target.toString(), {
  method: 'GET',
  redirect: 'follow',
});

const xFrameOptions = response.headers.get('x-frame-options');
const csp = response.headers.get('content-security-policy') || '';
const hasFrameAncestors = /(^|;)\s*frame-ancestors\s+/i.test(csp);
const allowsProcore = /frame-ancestors[^;]*https:\/\/\*\.procore\.com/i.test(csp);

console.log(`URL: ${response.url}`);
console.log(`Status: ${response.status}`);
console.log(`x-frame-options: ${xFrameOptions || '<missing>'}`);
console.log(`csp frame-ancestors present: ${hasFrameAncestors ? 'yes' : 'no'}`);
console.log(`csp allows *.procore.com: ${allowsProcore ? 'yes' : 'no'}`);

const failures = [];

if (xFrameOptions && /deny|sameorigin/i.test(xFrameOptions)) {
  failures.push('x-frame-options blocks iframe embedding (DENY/SAMEORIGIN).');
}

if (!hasFrameAncestors) {
  failures.push('content-security-policy is missing frame-ancestors.');
}

if (!allowsProcore) {
  failures.push('frame-ancestors does not include https://*.procore.com.');
}

if (failures.length > 0) {
  console.error('\nHeader verification failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(2);
}

console.log('\nHeader verification passed.');
