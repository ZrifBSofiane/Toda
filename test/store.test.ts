import { describe, expect, it } from 'vitest';
import { TODA_HEADER, emptyFile } from '../src/store.js';

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
