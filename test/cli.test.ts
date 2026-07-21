import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { run } from '../src/cli.js';
import type { CommandIO } from '../src/commands/doctor.js';

function makeIO() {
  const outChunks: string[] = [];
  const errChunks: string[] = [];
  const io: CommandIO = {
    stdout: (text) => outChunks.push(text),
    stderr: (text) => errChunks.push(text),
    env: {},
    cwd: process.cwd(),
    isTTY: false,
  };
  return { io, out: () => outChunks.join(''), err: () => errChunks.join('') };
}

describe('run', () => {
  it('prints root help with no arguments and exits 2', async () => {
    const cap = makeIO();
    expect(await run([], cap.io)).toBe(2);
    expect(cap.err()).toContain('Usage: offgrid-vision');
  });

  it('prints root help for --help and exits 0', async () => {
    const cap = makeIO();
    expect(await run(['--help'], cap.io)).toBe(0);
    expect(cap.out()).toContain('analyze');
    expect(cap.out()).toContain('doctor');
    expect(cap.out()).toContain('install-skill');
    expect(cap.out()).toContain('uninstall-skill');
  });

  it('prints the package version for --version', async () => {
    const cap = makeIO();
    const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
    expect(await run(['--version'], cap.io)).toBe(0);
    expect(cap.out().trim()).toBe(manifest.version);
  });

  it('rejects an unknown command with exit code 2', async () => {
    const cap = makeIO();
    expect(await run(['transcribe', 'video.mp4'], cap.io)).toBe(2);
    expect(cap.err()).toContain('transcribe');
  });

  it('routes to per-command help', async () => {
    const cap = makeIO();
    expect(await run(['analyze', '--help'], cap.io)).toBe(0);
    expect(cap.out()).toContain('Usage: offgrid-vision analyze');
  });

  it('routes install-skill help without installing', async () => {
    const cap = makeIO();
    expect(await run(['install-skill', '--help'], cap.io)).toBe(0);
    expect(cap.out()).toContain('Usage: offgrid-vision install-skill');
  });

  it('propagates a command usage error as exit code 2', async () => {
    const cap = makeIO();
    const code = await run(['analyze', '--concurrency', 'many', 'x.png'], cap.io);
    expect(code).toBe(2);
    expect(cap.err()).toContain('--concurrency');
  });
});
