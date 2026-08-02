export function esc(str: string): string {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function cleanValue(val: any): string {
  if (val === undefined || val === null) return '';
  let str = String(val).trim();
  if (str.startsWith('"') && str.endsWith('"') && str.length >= 2) {
    try {
      const parsed = JSON.parse(str);
      if (typeof parsed === 'string') str = parsed;
    } catch {
      str = str.slice(1, -1);
    }
  }
  return str;
}
