import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { loadAthenzTlsCredentials } from "../src/utils/exchange-athenz-at";

test("reloads rotated Athenz TLS credentials from disk", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "mcp-athenz-credentials-"));
  const certPath = path.join(directory, "service.cert.pem");
  const keyPath = path.join(directory, "service.key.pem");
  const caPath = path.join(directory, "ca.cert.pem");

  try {
    await Promise.all([
      writeFile(certPath, "certificate-v1"),
      writeFile(keyPath, "private-key-v1"),
      writeFile(caPath, "ca-v1"),
    ]);
    const first = await loadAthenzTlsCredentials(certPath, keyPath, caPath);

    await Promise.all([
      writeFile(certPath, "certificate-v2"),
      writeFile(keyPath, "private-key-v2"),
      writeFile(caPath, "ca-v2"),
    ]);
    const rotated = await loadAthenzTlsCredentials(certPath, keyPath, caPath);

    assert.equal(first.cert.toString(), "certificate-v1");
    assert.equal(first.key.toString(), "private-key-v1");
    assert.equal(first.ca.toString(), "ca-v1");
    assert.equal(rotated.cert.toString(), "certificate-v2");
    assert.equal(rotated.key.toString(), "private-key-v2");
    assert.equal(rotated.ca.toString(), "ca-v2");
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});
