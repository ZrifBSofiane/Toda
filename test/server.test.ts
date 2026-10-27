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

async function seedFile(): Promise<void> {
  let c = emptyFile();
  c = addItem(c, { what: 'stripe bug', why: 'd', revive: 'next payments work', refs: ['3f9c1a2'] }, '2026-10-26', 'D-001').content;
  c = addItem(c, { what: 'closed old', why: 'd', revive: 'r', status: 'x' }, '2026-09-01', 'D-002').content;
  fs.writeFileSync(todaFile, c);
}

describe('toda_list', () => {
  it('returns raw lines and excludes done by default', async () => {
    await seedFile();
    const client = await makeClient();
    const out = await call(client, 'toda_list');
    expect(out).toContain('stripe bug');
    expect(out).not.toContain('closed old');
    await client.close();
  });

  it('hints at toda_init when the file is missing', async () => {
    const client = await makeClient();
    const out = await call(client, 'toda_list');
    expect(out).toContain('toda_init');
    await client.close();
  });

  it('filters by keyword and includes the archive on demand', async () => {
    await seedFile();
    fs.writeFileSync(path.join(tmp, 'TODA-archive.md'), emptyFile() + 'D-050  x  2026-09-01  -  archived stripe item / d / revive: r\n');
    const client = await makeClient();
    expect(await call(client, 'toda_list', { keyword: 'STRIPE' })).toContain('stripe bug');
    const out = await call(client, 'toda_list', { status: ['x'], include_archive: true });
    expect(out).toContain('closed old');
    expect(out).toContain('archived stripe item');
    await client.close();
  });
});

describe('toda_set', () => {
  it('closes an item with a note and moves it to Done', async () => {
    await seedFile();
    const client = await makeClient();
    const out = await call(client, 'toda_set', { id: 'D-001', status: 'x', note: 'fixed in 3f9c1a2', ref: 'gh:#12' });
    expect(out).toContain('done: fixed in 3f9c1a2');
    expect(out).toContain('ref: 3f9c1a2 gh:#12');
    const content = readIfExists(todaFile)!;
    expect(content.indexOf('D-001')).toBeGreaterThan(content.indexOf('## Done'));
    await client.close();
  });

  it('errors with next action on unknown id', async () => {
    await seedFile();
    const client = await makeClient();
    const res = await client.callTool({ name: 'toda_set', arguments: { id: 'D-099', status: 'x' } });
    expect(res.isError).toBe(true);
    expect((res.content as { text: string }[])[0].text).toContain('toda_list');
    await client.close();
  });
});

describe('toda_prune', () => {
  it('moves old done items to the archive and reports the count', async () => {
    await seedFile();
    const client = await makeClient();
    const out = await call(client, 'toda_prune', { older_than_days: 30 });
    expect(out).toContain('pruned 1 item');
    expect(readIfExists(todaFile)!).not.toContain('closed old');
    expect(readIfExists(path.join(tmp, 'TODA-archive.md'))!).toContain('closed old');
    await client.close();
  });

  it('accepts older_than_days 0 to archive everything already closed', async () => {
    await seedFile();
    const client = await makeClient();
    const out = await call(client, 'toda_prune', { older_than_days: 0 });
    expect(out).toContain('pruned 1 item');
    await client.close();
  });

  it('is a no-op with nothing to move', async () => {
    const client = await makeClient();
    await call(client, 'toda_init');
    const out = await call(client, 'toda_prune');
    expect(out).toContain('pruned 0 item');
    expect(fs.existsSync(path.join(tmp, 'TODA-archive.md'))).toBe(false);
    await client.close();
  });
});
