'use strict';

const releases = {
  'v1.12.46': require('../upstream-v1.12.46.json'),
  'v1.12.50': require('../upstream.json'),
};

function selectRelease(version = 'v1.12.50') {
  const normalized = version.startsWith('v') ? version : `v${version}`;
  const manifest = releases[normalized];
  if (!manifest) throw new Error(`Unsupported Athenz version; choose ${Object.keys(releases).join(' or ')}`);
  return manifest;
}

module.exports = { selectRelease };
