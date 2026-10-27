import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { archivePath, readIfExists, todaPath, writeFile } from '../src/io.js';

let tmp: string;
const savedEnv = process.env.TODA_FILE;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'toda-io-'));
  process.env.TODA_FILE = path.join(tmp, 'TODA.md');
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  if (savedEnv === undefined) delete process.env.TODA_FILE;
  else process.env.TODA_FILE = savedEnv;
});

describe('io', () => {
  it('todaPath honors TODA_FILE', () => {
    expect(todaPath()).toBe(path.join(tmp, 'TODA.md'));
  });

  it('archivePath is a sibling of TODA.md', () => {
    expect(path.dirname(archivePath())).toBe(tmp);
    expect(path.basename(archivePath())).toBe('TODA-archive.md');
  });

  it('readIfExists returns null for missing files', () => {
    expect(readIfExists(todaPath())).toBeNull();
  });

  it('writeFile then readIfExists round-trips and appends a trailing newline', () => {
    writeFile(todaPath(), 'abc');
    expect(readIfExists(todaPath())).toBe('abc\n');
  });
});
