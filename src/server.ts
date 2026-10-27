// MCP wiring only: tool registration over store + io. Spec: §7.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import * as store from './store.js';
import * as io from './io.js';

export const PROTOCOL_SNIPPET =
  '**TODA rule:** When we defer an issue or idea, call `toda_add` in the same turn — never "at the end of the session". ' +
  'When starting a task, call `toda_list` and mention open items whose `revive:` trigger matches the task. ' +
  'When a fix lands, call `toda_set` with status `x` in the same turn.';

function text(t: string) {
  return { content: [{ type: 'text' as const, text: t }] };
}

function err(t: string) {
  return { ...text(t), isError: true as const };
}

function refs(s: string | undefined): string[] {
  return s ? s.split(/\s+/).filter(Boolean) : [];
}

export function buildServer(): McpServer {
  const server = new McpServer({ name: 'toda', version: '0.1.0' });

  server.tool('toda_init', 'Create TODA.md for the current project (idempotent); returns the convention-file snippet', {}, async () => {
    const p = io.todaPath();
    const existing = io.readIfExists(p);
    if (existing === null) io.writeFile(p, store.emptyFile());
    return text(`${existing === null ? 'created' : 'already exists'}: ${p}\n\n${PROTOCOL_SNIPPET}`);
  });

  server.tool('toda_add', 'Append a deferred item to TODA.md (auto-creates the file)', {
    what: z.string().describe('One-line description of the issue'),
    why_deferred: z.string().describe('Why it is not being fixed now'),
    revive_when: z.string().describe('Trigger condition to revisit'),
    where: z.string().optional().describe('Location token like src/x.ts:42 (default -)'),
    status: z.enum(['o', 's', 'x']).optional().describe('Defaults to o (open)'),
    ref: z.string().optional().describe('Space-separated refs: commit shas, gh:#123, tag names'),
  }, async (a) => {
    const p = io.todaPath();
    const hot = io.readIfExists(p) ?? store.emptyFile();
    const archive = io.readIfExists(io.archivePath());
    const { content, item } = store.addItem(
      hot,
      {
        what: a.what,
        why: a.why_deferred,
        revive: a.revive_when,
        where: a.where,
        status: a.status,
        refs: refs(a.ref),
      },
      store.today(),
      store.nextId(hot, archive),
    );
    io.writeFile(p, content);
    return text(`added ${item.id}\n${store.serializeItem(item)}`);
  });

  server.tool('toda_list', 'List deferred items (default: open + sleeping)', {
    status: z.array(z.enum(['o', 's', 'x'])).optional().describe('Defaults to ["o","s"]'),
    keyword: z.string().optional().describe('Substring match on the whole line (case-insensitive)'),
    ref: z.string().optional().describe('Substring match within the ref: segment only'),
    include_archive: z.boolean().optional().describe('Also scan TODA-archive.md'),
  }, async (a) => {
    const hot = io.readIfExists(io.todaPath());
    if (hot === null) return text('(no TODA.md here; call toda_init)');
    const { lines, unparsed } = store.listItems(
      hot,
      { statuses: a.status, keyword: a.keyword, ref: a.ref, includeArchive: a.include_archive },
      io.readIfExists(io.archivePath()),
    );
    const body = lines.length > 0 ? lines : ['(no matching items)'];
    const warn = unparsed > 0 ? [`(${unparsed} unparseable line(s) preserved verbatim)`] : [];
    return text([...body, ...warn].join('\n'));
  });

  server.tool('toda_set', 'Update an item status (moves it between sections)', {
    id: z.string().describe('Item id, e.g. D-017'),
    status: z.enum(['o', 's', 'x']),
    note: z.string().optional().describe('Closure note (used when status=x), e.g. the fix commit'),
    ref: z.string().optional().describe('Space-separated refs to merge into the item'),
  }, async (a) => {
    const p = io.todaPath();
    const hot = io.readIfExists(p);
    if (hot === null) return err('no TODA.md here; call toda_init');
    const res = store.setStatus(hot, a.id, { status: a.status, note: a.note, refs: refs(a.ref) });
    if (res === null) return err(`unknown id ${a.id}; call toda_list to see current ids`);
    io.writeFile(p, res.content);
    return text(store.serializeItem(res.item));
  });

  server.tool('toda_prune', 'Move done items older than N days into TODA-archive.md', {
    older_than_days: z.number().int().positive().optional().describe('Default 30'),
  }, async (a) => {
    const p = io.todaPath();
    const hot = io.readIfExists(p);
    if (hot === null) return err('no TODA.md here; call toda_init');
    const days = a.older_than_days ?? 30;
    const cutoff = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
    const ap = io.archivePath();
    const res = store.prune(hot, io.readIfExists(ap), cutoff);
    if (res.moved > 0) {
      io.writeFile(p, res.content);
      io.writeFile(ap, res.archive);
    }
    return text(`pruned ${res.moved} item(s) to ${ap}`);
  });

  return server;
}
