import { describe, expect, it } from 'vitest';
import { TODA_HEADER, addItem, cleanText, cleanWhere, emptyFile, nextId, parse, serializeItem, type Item } from '../src/store.js';

describe('emptyFile', () => {
  it('contains the fixed header and the three sections', () => {
    const f = emptyFile();
    for (const line of TODA_HEADER) expect(f).toContain(line);
    expect(f).toContain('## Open');
    expect(f).toContain('## Sleeping');
    expect(f).toContain('## Done');
    expect(f.endsWith('\n')).toBe(true);
  });

  it('orders sections canonically after the header', () => {
    const f = emptyFile();
    expect(f.indexOf('## Open')).toBeLessThan(f.indexOf('## Sleeping'));
    expect(f.indexOf('## Sleeping')).toBeLessThan(f.indexOf('## Done'));
  });
});

const base: Item = {
  id: 'D-017',
  status: 'o',
  opened: '2026-10-26',
  where: 'payments/stripe.ts:210',
  what: 'webhook retries can double-charge',
  why: 'cosmetic vs launch',
  revive: 'next payments work',
  refs: [],
};

describe('serializeItem', () => {
  it('writes canonical two-space columns and segment order', () => {
    expect(serializeItem(base)).toBe(
      'D-017  o  2026-10-26  payments/stripe.ts:210  webhook retries can double-charge / cosmetic vs launch / revive: next payments work',
    );
  });

  it('appends ref: and done: segments when present', () => {
    const line = serializeItem({ ...base, refs: ['3f9c1a2', 'gh:#123'], done: 'fixed in pr' });
    expect(line.endsWith('/ ref: 3f9c1a2 gh:#123 / done: fixed in pr')).toBe(true);
  });

  it('escapes the delimiter and newlines in user text', () => {
    const line = serializeItem({ ...base, what: 'a / b', why: 'line1\nline2' });
    expect(line).toContain('a ; b / line1 line2');
  });

  it('replaces whitespace in where with dashes', () => {
    expect(serializeItem({ ...base, where: 'some file.ts' })).toContain('  some-file.ts  ');
  });

  it('omits empty done segments', () => {
    expect(serializeItem({ ...base, status: 'x', done: '' })).not.toContain('done:');
  });
});

describe('cleanText / cleanWhere', () => {
  it('cleanText trims, strips newlines, escapes the delimiter', () => {
    expect(cleanText('  x / y\nz ')).toBe('x ; y z');
  });
  it('cleanWhere collapses whitespace to dashes, empty becomes dash', () => {
    expect(cleanWhere('a b')).toBe('a-b');
    expect(cleanWhere('')).toBe('-');
  });
});

describe('parse', () => {
  it('parses a canonical line', () => {
    const doc = parse(serializeItem(base) + '\n');
    expect(doc.items).toHaveLength(1);
    expect(doc.items[0]).toMatchObject({
      id: 'D-017', status: 'o', opened: '2026-10-26', where: 'payments/stripe.ts:210',
      what: 'webhook retries can double-charge', why: 'cosmetic vs launch',
      revive: 'next payments work', refs: [],
    });
    expect(doc.unparsed).toBe(0);
  });

  it('accepts typed segments in any order', () => {
    const line = 'D-001  o  2026-10-26  -  the what / the why / ref: abc / revive: later';
    expect(parse(line + '\n').items[0]).toMatchObject({ revive: 'later', refs: ['abc'] });
  });

  it('does not count header, comments, blanks or headings as unparsed', () => {
    const doc = parse(emptyFile());
    expect(doc.items).toHaveLength(0);
    expect(doc.unparsed).toBe(0);
  });

  it('counts stray prose as unparsed', () => {
    expect(parse('hello world\n').unparsed).toBe(1);
  });

  it('keeps the raw line for verbatim output', () => {
    const line = serializeItem(base);
    expect(parse(line + '\n').items[0].raw).toBe(line);
  });

  it('round-trips: serialize(parse(serialize(x))) is stable', () => {
    const line = serializeItem({ ...base, refs: ['aa', 'bb'], done: 'ok' });
    expect(serializeItem(parse(line + '\n').items[0])).toBe(line);
  });
});

describe('nextId', () => {
  it('starts at D-001 on an empty file', () => {
    expect(nextId(emptyFile())).toBe('D-001');
  });

  it('increments past the max in the hot file', () => {
    const hot = emptyFile() + 'D-009  x  2026-09-28  api/auth.py:44  rate limiter off-by-one / minor / done: abc\n';
    expect(nextId(hot)).toBe('D-010');
  });

  it('scans the archive too', () => {
    const hot = emptyFile() + 'D-003  o  2026-10-26  -  w / d / revive: r\n';
    const archive = emptyFile() + 'D-050  x  2026-09-01  -  old / old / done: x\n';
    expect(nextId(hot, archive)).toBe('D-051');
  });

  it('tolerates null contents', () => {
    expect(nextId(null, emptyFile(), undefined)).toBe('D-001');
  });
});

describe('addItem', () => {
  it('appends D-001 to the Open section of an empty file', () => {
    const { content, item } = addItem(emptyFile(), { what: 'w', why: 'd', revive: 'r' }, '2026-10-27');
    expect(item.id).toBe('D-001');
    expect(content).toContain('## Open\n\nD-001  o  2026-10-27  -  w / d / revive: r');
  });

  it('routes sleeping items to the Sleeping section', () => {
    const { content } = addItem(emptyFile(), { what: 'w', why: 'd', revive: 'r', status: 's' }, '2026-10-27');
    expect(content.indexOf('D-001')).toBeGreaterThan(content.indexOf('## Sleeping'));
  });

  it('accepts where, refs and an explicit id', () => {
    const { content, item } = addItem(
      emptyFile(),
      { what: 'w', why: 'd', revive: 'r', where: 'src/x.ts:1', refs: ['abc'], status: 'o' },
      '2026-10-27',
      'D-042',
    );
    expect(item.id).toBe('D-042');
    expect(content).toContain('D-042  o  2026-10-27  src/x.ts:1  w / d / revive: r / ref: abc');
  });

  it('creates a missing section at the end of the file', () => {
    const stripped = `${TODA_HEADER.join('\n')}\n\n## Open\n`;
    const { content } = addItem(stripped, { what: 'w', why: 'd', revive: 'r', status: 's' }, '2026-10-27');
    expect(content).toContain('## Sleeping\n');
    expect(content.indexOf('D-001')).toBeGreaterThan(content.indexOf('## Sleeping'));
  });

  it('preserves unknown lines across the rewrite', () => {
    const f = emptyFile() + 'my own hand-written note\n';
    const { content } = addItem(f, { what: 'w', why: 'd', revive: 'r' }, '2026-10-27');
    expect(content).toContain('my own hand-written note');
    expect(parse(content).unparsed).toBe(1);
  });

  it('assigns the next id based on existing items', () => {
    const once = addItem(emptyFile(), { what: 'w', why: 'd', revive: 'r' }, '2026-10-27');
    const twice = addItem(once.content, { what: 'w2', why: 'd', revive: 'r' }, '2026-10-27');
    expect(twice.item.id).toBe('D-002');
  });
});
