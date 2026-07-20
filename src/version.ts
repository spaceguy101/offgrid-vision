import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

interface Manifest {
  version: string;
}

const manifest = require('../package.json') as Manifest;

export function getVersion(): string {
  return manifest.version;
}
