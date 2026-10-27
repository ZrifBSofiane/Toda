// The only module that touches the filesystem. Spec: §5.

import * as fs from 'node:fs';
import * as path from 'node:path';

export function todaPath(): string {
  return process.env.TODA_FILE ?? path.join(process.cwd(), 'TODA.md');
}

export function archivePath(): string {
  return path.join(path.dirname(todaPath()), 'TODA-archive.md');
}

export function readIfExists(p: string): string | null {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return null;
  }
}

export function writeFile(p: string, content: string): void {
  fs.writeFileSync(p, content === '' || content.endsWith('\n') ? content : content + '\n');
}
