import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Buffer } from 'node:buffer';
import { sha256, discoverFiles } from '../src/media.js';
import { pngFixture } from './helpers/fixtures.js';

let root: string;

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'offgrid-discover-'));
  await mkdir(path.join(root, 'nested', 'deep'), { recursive: true });
  await writeFile(path.join(root, 'a.png'), pngFixture());
  await writeFile(path.join(root, 'b.JPG'), pngFixture());
  await writeFile(path.join(root, 'notes.txt'), 'ignore me');
  await writeFile(path.join(root, 'nested', 'c.webp'), pngFixture());
  await writeFile(path.join(root, 'nested', 'deep', 'd.gif'), pngFixture());
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('sha256', () => {
  it('hashes buffer contents', () => {
    expect(sha256(Buffer.from('hello', 'utf8'))).toBe(
      '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
    );
  });
});

describe('discoverFiles', () => {
  it('walks a directory recursively and skips unsupported extensions', async () => {
    const found = await discoverFiles([root], { recursive: true });
    expect(found.map((f) => path.basename(f))).toEqual(['a.png', 'b.JPG', 'c.webp', 'd.gif']);
  });

  it('stays at the top level when recursion is disabled', async () => {
    const found = await discoverFiles([root], { recursive: false });
    expect(found.map((f) => path.basename(f))).toEqual(['a.png', 'b.JPG']);
  });

  it('includes explicitly named files even with an unsupported extension', async () => {
    const found = await discoverFiles([path.join(root, 'notes.txt')], { recursive: true });
    expect(found.map((f) => path.basename(f))).toEqual(['notes.txt']);
  });

  it('returns absolute, sorted, de-duplicated paths', async () => {
    const target = path.join(root, 'a.png');
    const found = await discoverFiles([target, target, root], { recursive: false });
    expect(found.filter((f) => f.endsWith('a.png'))).toHaveLength(1);
    expect(found.every((f) => path.isAbsolute(f))).toBe(true);
    expect([...found].sort()).toEqual(found);
  });

  it('throws a helpful error when a path does not exist', async () => {
    await expect(discoverFiles([path.join(root, 'nope.png')], { recursive: true }))
      .rejects.toThrow(/no such file or directory|not found/i);
  });
});
