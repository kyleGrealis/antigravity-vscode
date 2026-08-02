import * as path from 'path';

export function toForwardSlash(p: string): string {
  return p.replace(/\\/g, '/');
}

export function normalizePath(p: string): string {
  return toForwardSlash(path.resolve(p));
}

export function normalizePathLower(p: string): string {
  return normalizePath(p).toLowerCase();
}

export function isInsidePath(child: string, parent: string): boolean {
  const nc = normalizePath(child);
  const np = normalizePath(parent);
  return nc.startsWith(np + '/') || nc === np;
}
