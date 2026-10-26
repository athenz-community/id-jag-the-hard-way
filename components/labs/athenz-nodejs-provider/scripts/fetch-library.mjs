import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import releases from './releases.cjs';

const root = fileURLToPath(new URL('../', import.meta.url));

export function blobHash(data) {
  return createHash('sha1').update(`blob ${data.length}\0`).update(data).digest('hex');
}

export async function fetchLibrary(manifest, directory) {
  // Download only the runtime files listed in the pinned manifest, never the
  // repository archive, test fixtures, credentials, or a moving npm release.
  for (const file of manifest.files) {
    const destination = resolve(directory, file.destination);
    try {
      const existing = await readFile(destination);
      if (blobHash(existing) !== file.sha) {
        throw new Error(`Local file differs from upstream; preserving it: ${file.destination}`);
      }
      console.log(`Verified ${file.path}`);
      continue;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }

    const url = `https://raw.githubusercontent.com/AthenZ/athenz/${manifest.revision}/${file.path}`;
    console.log(`Fetching ${file.path}`);
    const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`HTTP ${response.status} fetching ${file.path}`);
    const data = Buffer.from(await response.arrayBuffer());
    if (blobHash(data) !== file.sha) throw new Error(`Upstream hash mismatch: ${file.path}`);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, data, { flag: 'wx' });
  }

  console.log(`Athenz ${manifest.version} (${manifest.revision}): ${manifest.files.length} runtime/license files verified`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [requestedVersion = 'v1.12.50', selectedManifest] = process.argv.slice(2);
  const manifest = releases.selectRelease(requestedVersion);
  await fetchLibrary(manifest, resolve(root, 'vendor'));
  if (selectedManifest) {
    await writeFile(resolve(selectedManifest), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
  }
}
