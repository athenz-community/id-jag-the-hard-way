'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const appDir = path.resolve(__dirname, '..');
const repoDir = path.resolve(appDir, '../../..');
const defaultFile = path.join(appDir, '.local/endpoints.json');

function validateUrl(value, service) {
  const setting = `${service.toUpperCase()}_URL`;
  let url;
  try {
    if (typeof value !== 'string') throw new Error();
    url = new URL(value);
  } catch {
    throw new Error(`${setting} must be an HTTP(S) API base URL`);
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error(`${setting} must be an HTTP(S) URL without credentials, a query, or a fragment`);
  }
  const pathname = url.pathname.replace(/\/+$/, '');
  if (!pathname.endsWith(`/${service}/v1`)) {
    throw new Error(`${setting} must include the /${service}/v1 API base path`);
  }
  return `${url.origin}${pathname}`;
}

function localPort(service) {
  return execFileSync(path.join(repoDir, 'tools/port.sh'), [service], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'],
  }).trim();
}

function resolveEndpoints({ saved = {}, overrides = {}, portFor = localPort } = {}) {
  const result = {};
  for (const service of ['zms', 'zts']) {
    const key = `${service}Url`;
    let value = overrides[`${service.toUpperCase()}_URL`] || saved[key];
    if (!value) {
      const port = String(portFor(service));
      if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
        throw new Error(`IDTHW tools/port.sh returned an invalid ${service} port`);
      }
      value = `https://localhost:${port}/${service}/v1`;
    }
    result[key] = validateUrl(value, service);
  }
  return result;
}

function readSaved(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
  let saved;
  try {
    saved = JSON.parse(text);
  } catch {
    throw new Error('Endpoint configuration is not valid JSON; preserving the file');
  }
  if (!saved || typeof saved !== 'object' || Array.isArray(saved) ||
      Object.keys(saved).some(key => !['zmsUrl', 'ztsUrl'].includes(key) || typeof saved[key] !== 'string' || !saved[key])) {
    throw new Error('Endpoint configuration must contain only zmsUrl and ztsUrl; preserving the file');
  }
  return saved;
}

function loadEndpoints({ file = process.env.ATHENZ_ENDPOINTS_FILE || defaultFile, overrides = process.env, portFor = localPort } = {}) {
  return resolveEndpoints({ saved: readSaved(file), overrides, portFor });
}

function configureEndpoints(options = {}) {
  const file = options.file || process.env.ATHENZ_ENDPOINTS_FILE || defaultFile;
  const endpoints = loadEndpoints({ ...options, file });
  const text = `${JSON.stringify(endpoints, null, 2)}\n`;
  if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== text) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, text, { flag: 'wx' });
    fs.renameSync(temporary, file);
  }
  return endpoints;
}

if (require.main === module) {
  try {
    const [command = 'show', service] = process.argv.slice(2);
    if (command === 'configure') {
      console.log(JSON.stringify(configureEndpoints(), null, 2));
    } else if (command === 'show') {
      console.log(JSON.stringify(loadEndpoints(), null, 2));
    } else if (command === 'url' && ['zms', 'zts'].includes(service)) {
      console.log(loadEndpoints()[`${service}Url`]);
    } else {
      throw new Error('Usage: node scripts/endpoints.cjs configure|show|url <zms|zts>');
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { configureEndpoints, loadEndpoints, resolveEndpoints };
