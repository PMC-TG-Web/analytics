import assert from "node:assert/strict";
import test from "node:test";

import {
  createCommitmentMakerAccessToken,
  verifyCommitmentMakerAccessToken,
} from "../src/lib/commitmentMakerAccess.ts";

const secret = "test-only-commitment-maker-secret-with-enough-entropy";

test("signed Commitment Maker access is bound to one Procore project", async () => {
  const token = await createCommitmentMakerAccessToken("598134326626273", secret);

  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(await verifyCommitmentMakerAccessToken("598134326626273", token, secret), true);
  assert.equal(await verifyCommitmentMakerAccessToken("598134326626274", token, secret), false);
  assert.equal(await verifyCommitmentMakerAccessToken("598134326626273", `${token.slice(0, -1)}x`, secret), false);
});

test("Commitment Maker access rejects invalid project IDs and malformed tokens", async () => {
  await assert.rejects(
    createCommitmentMakerAccessToken("not-a-project", secret),
    /numeric Procore project ID/,
  );
  assert.equal(await verifyCommitmentMakerAccessToken("not-a-project", "a".repeat(43), secret), false);
  assert.equal(await verifyCommitmentMakerAccessToken("598134326626273", "unsigned", secret), false);
});
