'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { configureEndpoints, loadEndpoints, resolveEndpoints } = require('../scripts/endpoints.cjs');
const { selectRelease } = require('../scripts/releases.cjs');

const appDir = path.resolve(__dirname, '..');
const unexpectedPortLookup = () => { throw new Error('Unexpected IDTHW port lookup'); };

test('image versions select the pinned Athenz source and reject moving or unknown versions', () => {
  assert.equal(selectRelease().version, 'v1.12.50');
  assert.equal(selectRelease('1.12.46').revision, '519ffffb0210a5b524e9708455292f26cbd7a2a4');
  assert.equal(selectRelease('v1.12.50').revision, '8fb407836b73c8b487bd373ab3a60663c698b2ce');
  for (const version of ['latest', 'v1.12.47', '../../upstream', '']) {
    assert.throws(() => selectRelease(version), /Unsupported Athenz version/);
  }
});

function temporary(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nodejs-endpoints-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true }));
  return directory;
}

test('first-use local defaults follow the IDTHW port lookup', () => {
  assert.deepEqual(resolveEndpoints({ portFor: service => ({ zms: '14443', zts: '18443' })[service] }), {
    zmsUrl: 'https://localhost:14443/zms/v1', ztsUrl: 'https://localhost:18443/zts/v1',
  });
});

test('explicit URLs normalize trailing slashes and do not require local ports', () => {
  assert.deepEqual(resolveEndpoints({
    overrides: { ZMS_URL: 'https://zms.example.test/zms/v1/', ZTS_URL: 'https://zts.example.test/zts/v1/' },
    portFor: unexpectedPortLookup,
  }), { zmsUrl: 'https://zms.example.test/zms/v1', ztsUrl: 'https://zts.example.test/zts/v1' });
});

test('make configure persists overrides and preserves the other selected endpoint', t => {
  const file = path.join(temporary(t), 'endpoints.json');
  function configure(...settings) {
    const result = spawnSync('make', ['-C', appDir, 'configure', `ATHENZ_ENDPOINTS_FILE=${file}`, ...settings], {
      encoding: 'utf8', env: { PATH: process.env.PATH },
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);
  }
  configure('ZMS_URL=https://zms.example.test/zms/v1', 'ZTS_URL=https://first-zts.example.test/zts/v1');
  configure('ZTS_URL=https://second-zts.example.test/zts/v1');
  configure();
  assert.deepEqual(loadEndpoints({ file, overrides: {}, portFor: unexpectedPortLookup }), {
    zmsUrl: 'https://zms.example.test/zms/v1', ztsUrl: 'https://second-zts.example.test/zts/v1',
  });
});

test('invalid endpoint URLs are rejected before replacing saved configuration', t => {
  const file = path.join(temporary(t), 'endpoints.json');
  const original = JSON.stringify({ zmsUrl: 'https://zms.example.test/zms/v1', ztsUrl: 'https://zts.example.test/zts/v1' });
  fs.writeFileSync(file, original);
  for (const value of [
    'ftp://zts.example.test/zts/v1',
    'https://user@zts.example.test/zts/v1',
    'https://zts.example.test/zts/v1?x=1',
    'https://zts.example.test/zts/v1#fragment',
    'https://zts.example.test/zms/v1',
  ]) {
    assert.throws(() => configureEndpoints({ file, overrides: { ZTS_URL: value } }), /ZTS_URL/);
    assert.equal(fs.readFileSync(file, 'utf8'), original);
  }
});

test('invalid saved endpoint configuration is preserved', t => {
  const file = path.join(temporary(t), 'endpoints.json');
  for (const contents of ['invalid json', '{"unexpected":true}', '{"zmsUrl":0}']) {
    fs.writeFileSync(file, contents);
    assert.throws(() => configureEndpoints({ file, overrides: {}, portFor: unexpectedPortLookup }), /preserving the file/);
    assert.equal(fs.readFileSync(file, 'utf8'), contents);
  }
});

test('sync uses the selected servers and preserves the snapshot on HTTP or policy failure', t => {
  const directory = temporary(t);
  const bin = path.join(directory, 'bin');
  const file = path.join(directory, 'endpoints.json');
  const calls = path.join(directory, 'calls.jsonl');
  const configuration = path.join(directory, 'state/athenz.conf');
  const policyDir = path.join(directory, 'state/policies');
  fs.mkdirSync(bin);
  configureEndpoints({ file, overrides: {
    ZMS_URL: 'https://selected-zms.example.test/zms/v1',
    ZTS_URL: 'https://selected-zts.example.test/zts/v1',
  }, portFor: unexpectedPortLookup });

  // This curl stand-in records only URLs and returns noncredential fixtures.
  // It never opens certificate/key paths and never makes network requests.
  const curl = path.join(bin, 'curl');
  fs.writeFileSync(curl, `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
const url = args.at(-1);
const output = args[args.indexOf('--output') + 1];
fs.appendFileSync(process.env.SYNC_TEST_CALLS, JSON.stringify(url) + '\\n');
const policy = url.endsWith('/signed_policy_data');
if (policy && process.env.SYNC_TEST_FAIL === 'true') {
  fs.writeFileSync(output, JSON.stringify({code: 404, message: 'fixture policy unavailable'}));
  process.stdout.write('404');
} else {
  const assertion = {role: 'api:role.docs-getter', action: 'get', resource: 'api:docs'};
  if (process.env.SYNC_TEST_POLICY === 'missing') assertion.action = 'post';
  if (process.env.SYNC_TEST_POLICY === 'deny') assertion.effect = 'DENY';
  const body = policy ? {
    signedPolicyData: {policyData: {domain: 'api', policies: [{assertions: [assertion]}]}}
  } : {publicKeys: [{id: '0', key: 'fixture-public-key'}]};
  fs.writeFileSync(output, JSON.stringify(body));
  process.stdout.write('200');
}
`);
  fs.chmodSync(curl, 0o755);
  const env = {
    PATH: `${bin}:${process.env.PATH}`,
    ATHENZ_ENDPOINTS_FILE: file,
    ATHENZ_CA_CERT: '/dev/null', ATHENZ_CLIENT_CERT: '/dev/null', ATHENZ_CLIENT_KEY: '/dev/null',
    ATHENZ_CONF: configuration, ATHENZ_POLICY_DIR: policyDir,
    SYNC_TEST_CALLS: calls,
  };
  const run = extra => spawnSync('bash', [path.join(appDir, 'scripts/sync-policies.sh')], {
    encoding: 'utf8', env: { ...env, ...extra },
  });
  const success = run({});
  assert.equal(success.status, 0, success.stdout + success.stderr);
  assert.match(success.stdout, /"domain": "api"/);
  assert.match(success.stdout, /"docsGetterPolicy": true/);
  assert.deepEqual(fs.readFileSync(calls, 'utf8').trim().split('\n').map(line => JSON.parse(line)), [
    'https://selected-zms.example.test/zms/v1/domain/sys.auth/service/zms',
    'https://selected-zts.example.test/zts/v1/domain/sys.auth/service/zts',
    'https://selected-zts.example.test/zts/v1/domain/api/signed_policy_data',
  ]);
  const policyFile = path.join(policyDir, 'api.pol');
  const previousConfiguration = fs.readFileSync(configuration, 'utf8');
  const previousPolicy = fs.readFileSync(policyFile, 'utf8');
  const failure = run({ SYNC_TEST_FAIL: 'true' });
  assert.notEqual(failure.status, 0);
  assert.match(failure.stderr, /"code": 404/);
  assert.match(failure.stderr, /"message": "fixture policy unavailable"/);
  assert.equal(fs.readFileSync(configuration, 'utf8'), previousConfiguration);
  assert.equal(fs.readFileSync(policyFile, 'utf8'), previousPolicy);
  for (const policy of ['missing', 'deny']) {
    const invalidPolicy = run({ SYNC_TEST_POLICY: policy });
    assert.notEqual(invalidPolicy.status, 0);
    assert.match(invalidPolicy.stderr, /docs-getter get policy for api:docs is not available/);
    assert.equal(fs.readFileSync(configuration, 'utf8'), previousConfiguration);
    assert.equal(fs.readFileSync(policyFile, 'utf8'), previousPolicy);
  }
});
