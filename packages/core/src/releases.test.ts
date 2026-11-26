import assert from "node:assert/strict";
import { checkForUpdate, compareVersions } from "./releases";

assert.equal(compareVersions("0.1.2", "0.1.2"), 0);
assert.equal(compareVersions("0.1.3", "0.1.2"), 1);
assert.equal(compareVersions("0.1.2", "0.1.10"), -1);
assert.equal(compareVersions("1.0.0", "0.9.9"), 1);
assert.equal(compareVersions("0.1.2-beta", "0.1.2"), 0);

async function main() {
  const manifest = { version: "0.1.3", publishedAt: "2026-11-07T00:00:00Z", baseUrl: "https://example.test/0.1.3/", files: [], checksums: "SHA256SUMS", signature: "SHA256SUMS.mldsa65.json", publicKey: "wallet-release.pub" };
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => manifest });
  const result = await checkForUpdate("0.1.2", { fetchImpl });
  assert.equal(result.updateAvailable, true);
  assert.equal(result.latest, "0.1.3");
  const same = await checkForUpdate("0.1.3", { fetchImpl });
  assert.equal(same.updateAvailable, false);
  await assert.rejects(checkForUpdate("0.1.2", { fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({}) }) }), /HTTP 500/);
  await assert.rejects(checkForUpdate("0.1.2", { fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ nope: 1 }) }) }), /unexpected shape/);
  console.log("@minerva/core release checks ok");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
