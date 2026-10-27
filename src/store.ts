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
