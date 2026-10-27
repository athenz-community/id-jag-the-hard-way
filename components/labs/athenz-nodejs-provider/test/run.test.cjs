'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const appDir = path.resolve(__dirname, '..');
const oldName = 'idthw-nodejs-provider-v1.12.46';
const fixedName = 'idthw-nodejs-provider-v1.12.50';

function fixture(t, containers = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nodejs-run-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true }));
  const app = path.join(directory, 'components/labs/athenz-nodejs-provider');
  const bin = path.join(directory, 'bin');
  const state = path.join(directory, 'state.json');
  const calls = path.join(directory, 'calls.jsonl');
  fs.mkdirSync(path.join(app, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(app, '.local/policies'), { recursive: true });
  fs.mkdirSync(path.join(directory, 'tools'));
  fs.mkdirSync(bin);
  fs.copyFileSync(path.join(appDir, 'Makefile'), path.join(app, 'Makefile'));
  fs.copyFileSync(path.join(appDir, 'scripts/run-provider.sh'), path.join(app, 'scripts/run-provider.sh'));
  fs.copyFileSync(path.resolve(appDir, '../../../tools/color.sh'), path.join(directory, 'tools/color.sh'));
  fs.writeFileSync(path.join(app, '.local/athenz.conf'), '{}');
  fs.writeFileSync(path.join(app, '.local/policies/api.pol'), '{}');
  fs.writeFileSync(state, JSON.stringify(containers));
  fs.writeFileSync(calls, '');

  // Record container operations without contacting Docker or opening credential files.
  fs.writeFileSync(path.join(bin, 'docker'), `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
const stateFile = process.env.NODEJS_RUN_TEST_STATE;
const containers = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
fs.appendFileSync(process.env.NODEJS_RUN_TEST_CALLS, JSON.stringify(args) + '\\n');
function fail(message) { process.stderr.write(message + '\\n'); process.exit(1); }
if (args[0] === 'image' && args[1] === 'inspect') {
  if (process.env.NODEJS_RUN_TEST_MISSING_IMAGE === 'true') fail('Fixture image not found');
  process.stdout.write('sha256:fixture-image\\n');
} else if (args[0] === 'container' && args[1] === 'ls') {
  process.stdout.write(Object.keys(containers).join('\\n') + '\\n');
} else if (args[0] === 'container' && args[1] === 'stop') {
  const name = args[2];
  if (process.env.NODEJS_RUN_TEST_STOP_FAILURE === 'true') fail('Fixture stop failed');
  if (!containers[name]) fail('Unexpected container stop: ' + name);
  if (containers[name].running && containers[name].autoRemove) delete containers[name];
  else containers[name].running = false;
  process.stdout.write(name + '\\n');
} else if (args[0] === 'container' && args[1] === 'rm') {
  const name = args[2];
  if (!containers[name] || containers[name].running) fail('Unexpected container removal: ' + name);
  delete containers[name];
  process.stdout.write(name + '\\n');
} else if (args[0] === 'run') {
  const name = args[args.indexOf('--name') + 1];
  if (containers[name]) fail('Fixture container name conflict');
  if (Object.entries(containers).some(([name, value]) =>
    /^idthw-nodejs-provider-v1[.]12[.](46|50)$/.test(name) && value.running)) {
    fail('Fixture lab port conflict');
  }
  containers[name] = {running: true, autoRemove: true, image: args.at(-1)};
  process.stdout.write('Fixture provider started\\n');
} else {
  fail('Unexpected Docker operation: ' + JSON.stringify(args));
}
fs.writeFileSync(stateFile, JSON.stringify(containers));
`);
  fs.chmodSync(path.join(bin, 'docker'), 0o755);
  return {
    app,
    readState: () => JSON.parse(fs.readFileSync(state, 'utf8')),
    calls: () => fs.readFileSync(calls, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse),
    run: (settings = [], extraEnv = {}) => spawnSync('make', ['-C', app, 'run', ...settings], {
      encoding: 'utf8',
      env: {
        PATH: `${bin}:${process.env.PATH}`,
        NODEJS_RUN_TEST_STATE: state,
        NODEJS_RUN_TEST_CALLS: calls,
        ...extraEnv,
      },
    }),
  };
}

test('run switches versions and removes a failed start while preserving unrelated containers', t => {
  const unrelated = { running: true, autoRemove: false };
  const f = fixture(t, {
    [oldName]: { running: true, autoRemove: true },
    [fixedName]: { running: false, autoRemove: true },
    'idthw-nodejs-provider-v1.12.500': unrelated,
  });
  const result = f.run(['VERSION=v1.12.50']);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.deepEqual(f.readState(), {
    [fixedName]: { running: true, autoRemove: true, image: 'idthw-athenz-nodejs-provider:v1.12.50' },
    'idthw-nodejs-provider-v1.12.500': unrelated,
  });
  assert.deepEqual(f.calls().filter(args => args[0] === 'container' && args[1] !== 'ls'), [
    ['container', 'stop', oldName],
    ['container', 'stop', fixedName],
    ['container', 'rm', fixedName],
  ]);
  const command = f.calls().at(-1);
  assert.equal(command[0], 'run');
  assert.ok(command.includes('--rm'));
  assert.ok(command.includes('--pull=never'));
  assert.equal(command[command.indexOf('--publish') + 1], '127.0.0.1:18080:18080');
  assert.equal(command.filter(arg => arg.endsWith(',readonly')).length, 2);
});

for (const version of ['1.12.46', 'v1.12.50']) {
  test(`run replaces the same version and uses the newly selected image: ${version}`, t => {
    const normalized = version.startsWith('v') ? version : `v${version}`;
    const name = `idthw-nodejs-provider-${normalized}`;
    const f = fixture(t, { [name]: { running: true, autoRemove: false, image: 'previous-image' } });
    const result = f.run([`VERSION=${version}`, 'IMAGE=custom-provider:rebuilt', 'PORT=18081']);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.deepEqual(f.readState()[name], { running: true, autoRemove: true, image: 'custom-provider:rebuilt' });
    assert.equal(f.calls().at(-1)[f.calls().at(-1).indexOf('--publish') + 1], '127.0.0.1:18081:18080');
  });
}

test('a missing image or configuration leaves the running provider intact', t => {
  const containers = { [oldName]: { running: true, autoRemove: true } };
  const f = fixture(t, containers);
  const result = f.run([], { NODEJS_RUN_TEST_MISSING_IMAGE: 'true' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Fixture image not found/);
  assert.match(result.stderr, /run make build VERSION=v1.12.50 first/);
  assert.deepEqual(f.readState(), containers);
  assert.equal(f.calls().length, 1);
  fs.unlinkSync(path.join(f.app, '.local/policies/api.pol'));
  const missingPolicy = f.run();
  assert.notEqual(missingPolicy.status, 0);
  assert.match(missingPolicy.stderr, /run make sync first/);
  assert.deepEqual(f.readState(), containers);
  assert.equal(f.calls().length, 1);
});

test('a stop failure prevents removal and starting the replacement', t => {
  const containers = { [oldName]: { running: true, autoRemove: true } };
  const f = fixture(t, containers);
  const result = f.run([], { NODEJS_RUN_TEST_STOP_FAILURE: 'true' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Fixture stop failed/);
  assert.deepEqual(f.readState(), containers);
  assert.deepEqual(f.calls().at(-1), ['container', 'stop', oldName]);
});

test('unsupported versions and invalid ports fail before any Docker operation', t => {
  const f = fixture(t);
  for (const settings of [['VERSION=v1.12.47'], ['PORT=invalid'], ['PORT=0'], ['PORT=65536']]) {
    assert.notEqual(f.run(settings).status, 0);
  }
  assert.deepEqual(f.calls(), []);
});
