'use strict';

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const AuthZPEClient = require('@athenz/zpe-client');
const ZPEUpdater = require('@athenz/zpe-client/src/ZPEUpdater');
const { configureLogging } = require('./logging.cjs');
const { version, revision } = require('../upstream.json');
const localStateDir = path.resolve(__dirname, '../.local');

const statuses = AuthZPEClient.AccessCheckStatus;
const statusNames = new Map(Object.entries(statuses).map(([name, value]) => [value, name]));

function createProvider({
  domain = 'api',
  confFileName = process.env.ATHENZ_CONF || path.join(localStateDir, 'athenz.conf'),
  policyDir = process.env.ATHENZ_POLICY_DIR || path.join(localStateDir, 'policies'),
  logger = configureLogging(),
} = {}) {
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(domain)) throw new Error('Invalid Athenz domain');
  const resource = `${domain}:docs`;

  AuthZPEClient.setConfig({
    zpeClient: { confFileName, policyDir, disableWatch: true, allowedOffset: 300 },
  });
  AuthZPEClient.init();

  function loadPolicy() {
    // This small demo validates the snapshot on every request. The pinned
    // library does not enforce signed-policy expiry, and cached role tokens
    // otherwise skip repeat expiry checks, so never reuse its request caches.
    ZPEUpdater.close();
    const snapshot = JSON.parse(fs.readFileSync(path.join(policyDir, `${domain}.pol`), 'utf8'));
    const expires = Date.parse(snapshot.signedPolicyData?.expires);
    if (snapshot.signedPolicyData?.policyData?.domain !== domain ||
        !Number.isFinite(expires) || expires <= Date.now()) {
      throw new Error('Missing, expired, or mismatched policy snapshot');
    }
    ZPEUpdater.loadFiles(policyDir);
    if (!ZPEUpdater.getRoleAllowAssertions(domain)) {
      throw new Error('Policy signatures could not be verified');
    }
  }

  function send(response, code, body) {
    response.writeHead(code, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    response.end(`${JSON.stringify(body)}\n`);
  }

  const server = http.createServer((request, response) => {
    const pathname = request.url.split('?')[0];
    if (request.method === 'GET' && pathname === '/healthz') {
      return send(response, 200, { status: 'ok', athenzVersion: version, athenzRevision: revision });
    }
    if (request.method === 'GET' && pathname === '/readyz') {
      try {
        loadPolicy();
        return send(response, 200, { status: 'ready', domain });
      } catch {
        logger.warn('Policy snapshot unavailable or invalid');
        return send(response, 503, { error: 'policy_unavailable' });
      }
    }
    if (pathname !== '/api/docs') return send(response, 404, { error: 'not_found' });
    if (!['GET', 'POST'].includes(request.method)) {
      response.setHeader('Allow', 'GET, POST');
      return send(response, 405, { error: 'method_not_allowed' });
    }

    const roleToken = request.headers['athenz-role-auth'];
    if (typeof roleToken !== 'string' || roleToken.length === 0) {
      return send(response, 401, {
        error: 'missing_role_token',
        message: 'Send an Athenz role token in Athenz-Role-Auth.',
      });
    }
    try {
      loadPolicy();
    } catch {
      logger.warn('Policy snapshot unavailable or invalid');
      return send(response, 503, { error: 'policy_unavailable' });
    }

    const action = request.method.toLowerCase();
    try {
      AuthZPEClient.allowAccess({ roleToken, action, resource }, (error, status) => {
        // Remove both the credential and policy caches after this decision.
        ZPEUpdater.close();
        const decision = statusNames.get(status) || 'DENY';
        logger.info(`${request.method} /api/docs action=${action} resource=${resource} decision=${decision}`);
        if (!error && status === statuses.ALLOW) {
          return send(response, 200, {
            message: 'Documents from the Athenz Node.js provider', action, resource, decision,
          });
        }
        const invalid = [statuses.DENY_ROLETOKEN_INVALID, statuses.DENY_ROLETOKEN_EXPIRED].includes(status);
        return send(response, invalid ? 401 : 403, {
          error: invalid ? 'invalid_role_token' : 'forbidden',
          decision,
          message: status || 'Access denied',
        });
      });
    } catch {
      ZPEUpdater.close();
      logger.error('ZPE authorization failed');
      send(response, 503, { error: 'authorization_unavailable' });
    }
  });
  server.on('close', () => AuthZPEClient.close());
  return server;
}

if (require.main === module) {
  const logger = configureLogging();
  try {
    const port = Number(process.env.PORT || 18080);
    const host = process.env.HOST || '127.0.0.1';
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid port');
    const server = createProvider({ logger });
    server.listen(port, host, () => {
      logger.info(`Node.js provider listening on http://${host}:${port}; Athenz ${version} (${revision})`);
    });
    const shutdown = () => server.close(() => process.exit(0));
    process.once('SIGTERM', shutdown);
    process.once('SIGINT', shutdown);
    server.on('error', () => {
      logger.error('HTTP server failed to start');
      process.exitCode = 1;
    });
  } catch {
    logger.error('Provider startup failed; prepare .local/athenz.conf and .local/policies, or set ATHENZ_CONF and ATHENZ_POLICY_DIR');
    process.exitCode = 1;
  }
}

module.exports = { createProvider };
