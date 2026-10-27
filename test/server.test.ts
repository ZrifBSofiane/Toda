import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { buildServer } from '../src/server.js';
import { emptyFile, parse, serializeItem, addItem } from '../src/store.js';
import { readIfExists } from '../src/io.js';

let tmp: string;
let todaFile: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'toda-e2e-'));
  todaFile = path.join(tmp, 'TODA.md');
  process.env.TODA_FILE = todaFile;
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  delete process.env.TODA_FILE;
});

async function call(client: Client, name: string, args: Record<string, unknown> = {}): Promise<string> {
  const res = await client.callTool({ name, arguments: args });
  return (res.content as { type: string; text: string }[])[0].text;
}

async function makeClient(): Promise<Client> {
  const client = new Client({ name: 'test', version: '0.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), buildServer().connect(serverTransport)]);
  return client;
}

describe('toda_init', () => {
  it('creates the file and returns the protocol snippet', async () => {
    const client = await makeClient();
    const out = await call(client, 'toda_init');
    expect(out).toContain('created');
    expect(out).toContain('TODA rule');
    expect(readIfExists(todaFile)).toBe(emptyFile());
    await client.close();
  });

  it('is idempotent', async () => {
    const client = await makeClient();
    await call(client, 'toda_init');
    const out = await call(client, 'toda_init');
    expect(out).toContain('already exists');
    await client.close();
  });
});

describe('toda_add', () => {
  it('auto-creates the file, assigns sequential ids and returns the canonical line', async () => {
    const client = await makeClient();
    const out1 = await call(client, 'toda_add', {
      what: 'stripe retries', why_deferred: 'cosmetic vs launch', revive_when: 'next payments work',
      where: 's.ts:10', ref: '3f9c1a2',
    });
    const out2 = await call(client, 'toda_add', {
      what: 'docs stale', why_deferred: 'low traffic', revive_when: 'v2.1',
    });
    expect(out1).toMatch(
      /^added D-001\nD-001  o  \d{4}-\d{2}-\d{2}  s.ts:10  stripe retries \/ cosmetic vs launch \/ revive: next payments work \/ ref: 3f9c1a2$/,
    );
    expect(out2).toContain('added D-002');
    const doc = parse(readIfExists(todaFile)!);
    expect(doc.items).toHaveLength(2);
    await client.close();
  });

  it('does not resurrect an archive id', async () => {
    const archiveFile = path.join(tmp, 'TODA-archive.md');
    fs.writeFileSync(archiveFile, emptyFile() + 'D-007  x  2026-09-01  -  old / d / revive: r\n');
    const client = await makeClient();
    const out = await call(client, 'toda_add', { what: 'w', why_deferred: 'd', revive_when: 'r' });
    expect(out).toContain('added D-008');
    await client.close();
  });
});
