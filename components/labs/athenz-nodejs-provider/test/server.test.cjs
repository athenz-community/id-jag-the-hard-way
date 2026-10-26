'use strict';

const assert = require('node:assert/strict');
const { createHash, generateKeyPairSync } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { test } = require('node:test');
const { RoleToken, Crypto, YBase64 } = require('@athenz/auth-core');
const { createProvider } = require('../src/server.cjs');
const { configureLogging, redact } = require('../src/logging.cjs');
const upstream = require('../upstream.json');

test('installed Athenz runtime files match the pinned source', () => {
  for (const file of upstream.files) {
    if (file.destination === 'LICENSE') continue;
    const [directory, ...parts] = file.destination.split('/');
    const packageName = directory === 'zpe' ? '@athenz/zpe-client' : '@athenz/auth-core';
    const packageRoot = path.dirname(require.resolve(`${packageName}/package.json`));
    const data = fs.readFileSync(path.join(packageRoot, ...parts));
    const hash = createHash('sha1').update(`blob ${data.length}\0`).update(data).digest('hex');
    assert.equal(hash, file.sha, file.path);
  }
});

function canonical(value) {
  return JSON.stringify(value, (_key, item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
    return Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]]));
  });
}

test('real ZPE HTTP authorization with isolated fixtures', async (t) => {
  // No existing lab credentials are read. Private fixture keys stay in memory,
  // and neither keys nor tokens are written to test output or credential files.
  const zts = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const zms = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'nodejs-provider-test-'));
  const policyDir = path.join(temporary, 'policies');
  fs.mkdirSync(policyDir);
  const confFileName = path.join(temporary, 'athenz.conf');
  const policyFile = path.join(policyDir, 'nodejs-provider.pol');
  const publicEntry = pair => [{
    id: '0',
    key: YBase64.ybase64Encode(pair.publicKey.export({ type: 'spki', format: 'pem' })),
  }];
  fs.writeFileSync(confFileName, JSON.stringify({
    ztsPublicKeys: publicEntry(zts), zmsPublicKeys: publicEntry(zms),
  }));

  const policies = [{
    name: 'nodejs-provider:policy.hello-reader',
    assertions: [{ role: 'nodejs-provider:role.hello-reader', action: 'read', resource: 'nodejs-provider:hello', effect: 'ALLOW' }],
  }];
  function snapshot(expires = new Date(Date.now() + 3_600_000).toISOString(), assertions = policies) {
    const policyData = { domain: 'nodejs-provider', policies: assertions };
    const signedPolicyData = {
      policyData, zmsSignature: Crypto.sign(canonical(policyData), zms.privateKey, 'SHA256'),
      zmsKeyId: '0', modified: new Date().toISOString(), expires,
    };
    return {
      signedPolicyData, signature: Crypto.sign(canonical(signedPolicyData), zts.privateKey, 'SHA256'), keyId: '0',
    };
  }
  const validSnapshot = snapshot();
  const writeSnapshot = value => fs.writeFileSync(policyFile, JSON.stringify(value));
  writeSnapshot(validSnapshot);

  const fixtureTokens = [];
  function token(options = {}) {
    const value = new RoleToken({
      version: 'Z1', domain: 'nodejs-provider', roles: ['hello-reader'],
      principal: 'test.caller', expirationWindow: 60, ...options,
    });
    value.sign(zts.privateKey);
    const signed = value.getSignedToken();
    fixtureTokens.push(signed);
    return signed;
  }
  const logs = [];
  const logger = configureLogging(line => logs.push(line));
  const server = createProvider({ confFileName, policyDir, logger });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const validToken = token();
  async function request(route, roleToken, method = 'GET') {
    const response = await fetch(`${base}${route}`, {
      method, headers: roleToken ? { 'Athenz-Role-Auth': roleToken } : {},
    });
    return { status: response.status, body: await response.json() };
  }
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(temporary, { recursive: true });
  });

  await t.test('health reports the pinned release and source revision', async () => {
    const result = await request('/healthz');
    assert.equal(result.status, 200);
    assert.equal(result.body.athenzVersion, 'v1.12.50');
    assert.equal(result.body.athenzRevision, '8fb407836b73c8b487bd373ab3a60663c698b2ce');
  });
  await t.test('readiness verifies both signed policy layers', async () => {
    assert.deepEqual(await request('/readyz'), {
      status: 200, body: { status: 'ready', domain: 'nodejs-provider' },
    });
  });
  await t.test('missing role token is rejected', async () => {
    const result = await request('/hello');
    assert.equal(result.status, 401);
    assert.equal(result.body.error, 'missing_role_token');
  });
  await t.test('read is allowed by the real library', async () => {
    assert.deepEqual(await request('/hello', validToken), {
      status: 200,
      body: { message: 'Hello from the Athenz Node.js provider', action: 'read', resource: 'nodejs-provider:hello', decision: 'ALLOW' },
    });
  });
  await t.test('the same valid token cannot write', async () => {
    const result = await request('/hello', validToken, 'POST');
    assert.equal(result.status, 403);
    assert.equal(result.body.decision, 'DENY_NO_MATCH');
  });
  await t.test('malformed role tokens return 401 without crashing', async () => {
    for (const invalid of ['not-a-role-token', `${validToken};r=administrator`, validToken.replace(/;e=\d+/, ';e=NaN')]) {
      const result = await request('/hello', invalid);
      assert.equal(result.status, 401);
      assert.equal(result.body.decision, 'DENY_ROLETOKEN_INVALID');
    }
    assert.equal((await request('/healthz')).status, 200);
  });
  await t.test('a token with an invalid signature is rejected', async () => {
    const result = await request('/hello', validToken.replace('r=hello-reader', 'r=administrator'));
    assert.equal(result.status, 401);
    assert.equal(result.body.decision, 'DENY_ROLETOKEN_INVALID');
  });
  await t.test('a valid token for another domain is denied', async () => {
    const result = await request('/hello', token({ domain: 'other-domain' }));
    assert.equal(result.status, 403);
    assert.equal(result.body.decision, 'DENY_DOMAIN_MISMATCH');
  });
  await t.test('a future token outside the clock offset is rejected', async () => {
    assert.equal((await request('/hello', token({ issueTime: Math.floor(Date.now() / 1000) + 600 }))).status, 401);
  });
  await t.test('a previously accepted token is rejected after expiry', async () => {
    assert.equal((await request('/hello', validToken)).status, 200);
    const originalNow = Date.now;
    try {
      Date.now = () => originalNow() + 120_000;
      const result = await request('/hello', validToken);
      assert.equal(result.status, 401);
      assert.equal(result.body.decision, 'DENY_ROLETOKEN_EXPIRED');
    } finally {
      Date.now = originalNow;
    }
  });
  await t.test('explicit deny takes precedence over allow', async () => {
    const withDeny = structuredClone(policies);
    withDeny[0].assertions.push({ role: 'nodejs-provider:role.hello-reader', action: 'read', resource: 'nodejs-provider:hello', effect: 'DENY' });
    writeSnapshot(snapshot(undefined, withDeny));
    try {
      const result = await request('/hello', validToken);
      assert.equal(result.status, 403);
      assert.equal(result.body.decision, 'DENY');
    } finally {
      writeSnapshot(validSnapshot);
    }
  });
  await t.test('a changed policy with an invalid ZTS signature is unavailable', async () => {
    const changed = structuredClone(validSnapshot);
    changed.signedPolicyData.policyData.policies[0].name = 'nodejs-provider:policy.changed';
    writeSnapshot(changed);
    try {
      assert.equal((await request('/readyz')).status, 503);
      assert.equal((await request('/hello', validToken)).status, 503);
    } finally {
      writeSnapshot(validSnapshot);
    }
  });
  await t.test('a valid ZTS signature cannot hide an invalid ZMS signature', async () => {
    const changed = structuredClone(validSnapshot);
    changed.signedPolicyData.policyData.policies[0].name = 'nodejs-provider:policy.changed';
    changed.signature = Crypto.sign(canonical(changed.signedPolicyData), zts.privateKey, 'SHA256');
    writeSnapshot(changed);
    try {
      assert.equal((await request('/hello', validToken)).status, 503);
    } finally {
      writeSnapshot(validSnapshot);
    }
  });
  await t.test('expired and missing policy snapshots fail closed', async () => {
    writeSnapshot(snapshot(new Date(Date.now() - 1000).toISOString()));
    try {
      assert.equal((await request('/hello', validToken)).status, 503);
      fs.renameSync(policyFile, `${policyFile}.unavailable`);
      assert.equal((await request('/readyz')).status, 503);
    } finally {
      writeSnapshot(validSnapshot);
    }
  });
  await t.test('logs retain decisions but exclude credential values', () => {
    assert.ok(logs.some(line => line.includes('decision=ALLOW')));
    assert.ok(logs.some(line => line.includes('DENY_ROLETOKEN_EXPIRED')));
    assert.equal(logs.some(line => fixtureTokens.some(value => line.includes(value))), false, 'A fixture token appeared in logs');
    assert.equal(logs.some(line => line.includes('v=Z1;')), false, 'Unsigned token claims appeared in logs');
    assert.equal(redact('Token:validate: token=example : authentication failed'), 'Token:validate: token=[redacted] : authentication failed');
  });
});
