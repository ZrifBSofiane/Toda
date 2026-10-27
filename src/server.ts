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

  return server;
}
