// Pure format logic: string in, string out. No fs, no MCP. Spec: §6.

export const TODA_HEADER = [
  '# TODA — deferred items',
  '<!-- one item per line: ID STATUS OPENED WHERE WHAT / WHY / revive: TRIGGER [/ ref: REFS] [/ done: NOTE] -->',
  '<!-- statuses: o=open, s=sleeping, x=done. Human edits are fine; tools preserve unknown lines. -->',
] as const;

export function emptyFile(): string {
  return `${TODA_HEADER.join('\n')}\n\n## Open\n\n## Sleeping\n\n## Done\n`;
}

export function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export const STATUSES = ['o', 's', 'x'] as const;
export type Status = (typeof STATUSES)[number];

export const SECTION_BY_STATUS: Record<Status, string> = { o: 'Open', s: 'Sleeping', x: 'Done' };

export interface Item {
  id: string;
  status: Status;
  opened: string;
  where: string;
  what: string;
  why: string;
  revive: string;
  refs: string[];
  done?: string;
}

export interface ParsedItem extends Item {
  raw: string;
}

export interface ParsedDoc {
  items: ParsedItem[];
  unparsed: number;
}

const ITEM_RE = /^(D-\d+)\s+([osx])\s+(\d{4}-\d{2}-\d{2})\s+(\S+)\s+(.+)$/;

function isNoise(line: string): boolean {
  const t = line.trim();
  return t === '' || t.startsWith('#') || t.startsWith('<!--');
}

export function cleanText(s: string): string {
  return s.replace(/\r?\n/g, ' ').replace(/ \/ /g, ' ; ').trim();
}

export function cleanWhere(s: string): string {
  return cleanText(s).replace(/\s+/g, '-') || '-';
}

export function parse(content: string): ParsedDoc {
  const items: ParsedItem[] = [];
  let unparsed = 0;
  for (const line of content.split('\n')) {
    const m = ITEM_RE.exec(line);
    if (m) items.push({ ...itemFromMatch(m), raw: line });
    else if (!isNoise(line)) unparsed++;
  }
  return { items, unparsed };
}

function itemFromMatch(m: RegExpExecArray): Item {
  const [, id, status, opened, where, rest] = m;
  const item: Item = { id, status: status as Status, opened, where, what: '', why: '', revive: '', refs: [] };
  const untyped: string[] = [];
  for (const seg of rest.split(' / ')) {
    if (seg.startsWith('revive:')) item.revive = seg.slice('revive:'.length).trim();
    else if (seg.startsWith('ref:')) item.refs = seg.slice('ref:'.length).trim().split(/\s+/).filter(Boolean);
    else if (seg.startsWith('done:')) item.done = seg.slice('done:'.length).trim();
    else untyped.push(seg);
  }
  item.what = untyped.shift() ?? '';
  item.why = untyped.join(' / ');
  return item;
}

export function serializeItem(item: Item): string {
  const segs: string[] = [cleanText(item.what), cleanText(item.why)];
  if (item.revive !== '') segs.push(`revive: ${cleanText(item.revive)}`);
  if (item.refs.length > 0) segs.push(`ref: ${item.refs.map(cleanText).join(' ')}`);
  if (item.done !== undefined && item.done !== '') segs.push(`done: ${cleanText(item.done)}`);
  return `${item.id}  ${item.status}  ${item.opened}  ${cleanWhere(item.where)}  ${segs.join(' / ')}`;
}

export function nextId(...contents: (string | null | undefined)[]): string {
  let max = 0;
  for (const c of contents) {
    if (!c) continue;
    for (const m of c.matchAll(/^D-(\d+)\s/gm)) max = Math.max(max, Number(m[1]));
  }
  return `D-${String(max + 1).padStart(3, '0')}`;
}
