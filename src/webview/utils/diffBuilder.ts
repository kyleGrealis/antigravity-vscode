import { cleanValue, esc } from './escape';
import { getArgVal, parseJsonArgs, extractJsonStringField } from './formatters';

export function extractStringResult(rawResult: any): string {
  if (!rawResult) return '';
  if (typeof rawResult === 'string') return rawResult;
  if (typeof rawResult === 'object') {
    if (typeof rawResult.output === 'string') return rawResult.output;
    if (typeof rawResult.content === 'string') return rawResult.content;
    if (typeof rawResult.text === 'string') return rawResult.text;
    if (typeof rawResult.result === 'string') return rawResult.result;
    if (typeof rawResult.response === 'string') return rawResult.response;
    if (typeof rawResult.diff === 'string') return rawResult.diff;
    if (typeof rawResult.changes === 'string') return rawResult.changes;
    if (typeof rawResult.stdout === 'string') return rawResult.stdout;
    if (rawResult.result && typeof rawResult.result === 'object') {
      return extractStringResult(rawResult.result);
    }
    if (rawResult.output && typeof rawResult.output === 'object') {
      return extractStringResult(rawResult.output);
    }
    try {
      return JSON.stringify(rawResult);
    } catch {
      return '';
    }
  }
  return String(rawResult);
}

export function extractTargetFile(toolName: string, rawArgs: any, rawResult?: any): string | undefined {
  let args = rawArgs;
  if (typeof args === 'string') {
    try { args = JSON.parse(args); } catch {}
  }
  if (typeof args === 'object' && args) {
    const file = getArgVal(args, 'TargetFile', 'targetFile', 'target_file', 'path', 'file', 'AbsolutePath', 'absolutePath', 'FilePath', 'filePath');
    if (file && typeof file === 'string') return cleanValue(file);
  }
  const resultStr = extractStringResult(rawResult);
  if (resultStr) {
    const match =
      resultStr.match(/(?:to|file):\s*([^\s\n\r"']+\.[a-zA-Z0-9]+)/i) ||
      resultStr.match(/(?:to|file):\s*([^\s\n\r"']+)/i) ||
      resultStr.match(/(?:\-\-\-\s*a\/|\+\+\+\s*b\/)([^\s\n\r"']+)/);
    if (match && match[1]) return cleanValue(match[1].trim());
  }
  return undefined;
}

export function isDiffText(text: string): boolean {
  if (!text || typeof text !== 'string') return false;
  if (text.includes('[diff_block_start]')) return true;
  if ((text.includes('--- ') || text.includes('--- a/')) && (text.includes('+++ ') || text.includes('+++ b/'))) return true;
  if (/^@@ -\d+(,\d+)? \+\d+(,\d+)? @@/m.test(text) || /^@@ chunk \d+ @@/m.test(text) || /^@@ edit @@/m.test(text)) return true;

  const lines = text.split('\n');
  const hasDiffHeader = lines.some(l => l.startsWith('diff --git') || l.startsWith('index '));
  if (hasDiffHeader) return true;

  const hasHunk = lines.some(l => l.startsWith('@@ '));
  const hasMinus = lines.some(l => l.startsWith('- ') && !l.startsWith('--- '));
  const hasPlus = lines.some(l => l.startsWith('+ ') && !l.startsWith('+++ '));

  return hasHunk && (hasMinus || hasPlus);
}

export function isFileEditTool(toolName: string): boolean {
  const norm = (toolName || '').toLowerCase().replace(/[-_]/g, '');
  return (
    norm === 'replacefilecontent' ||
    norm === 'multireplacefilecontent' ||
    norm === 'writetofile' ||
    norm === 'writefile' ||
    norm === 'createfile' ||
    norm === 'codeaction'
  );
}

export function buildDiffFromToolArgs(toolName: string, rawArgs: any, rawResult?: any): string | null {
  const name = (toolName || '').toLowerCase().replace(/[-_]/g, '');

  const resultStr = extractStringResult(rawResult);

  // 1. Try extracting diff from resultStr if present
  if (resultStr) {
    const diffBlockMatch = resultStr.match(/\[diff_block_start\]([\s\S]*?)\[diff_block_end\]/);
    if (diffBlockMatch && diffBlockMatch[1].trim()) {
      let rawDiff = diffBlockMatch[1].trim();
      if (!rawDiff.includes('--- ') && !rawDiff.includes('+++ ')) {
        const args = parseJsonArgs(rawArgs);
        const file = getArgVal(args, 'TargetFile', 'targetFile', 'target_file', 'path', 'file', 'AbsolutePath', 'absolutePath', 'FilePath', 'filePath') || extractTargetFile(toolName, rawArgs, rawResult) || '';
        const fileName = file ? String(file).replace(/^"|"$/g, '').split(/[\/\\]/).pop() : 'file';
        rawDiff = `--- a/${fileName}\n+++ b/${fileName}\n${rawDiff}`;
      }
      return rawDiff;
    }
    if (isDiffText(resultStr)) {
      return resultStr.trim();
    }
  }

  // 2. Build diff from args object or fallback string parsing
  let args = parseJsonArgs(rawArgs);
  let diffLines: string[] = [];

  const extractField = (keyName: string, ...altKeys: string[]) => {
    const allKeys = [keyName, ...altKeys];
    if (typeof args === 'object' && args) {
      const val = getArgVal(args, ...allKeys);
      if (val !== undefined && val !== null) return val;
    }
    if (typeof rawArgs === 'string') {
      return extractJsonStringField(rawArgs, ...allKeys);
    }
    return undefined;
  };

  const file = extractField('TargetFile', 'targetFile', 'target_file', 'path', 'file', 'AbsolutePath', 'absolutePath', 'FilePath', 'filePath') || extractTargetFile(toolName, rawArgs, rawResult) || '';
  const fileName = file ? String(file).replace(/^"|"$/g, '').split(/[\/\\]/).pop() || 'file' : 'file';

  const chunks = extractField('ReplacementChunks', 'replacementChunks', 'replacement_chunks', 'chunks');
  const hasChunks = Array.isArray(chunks) && chunks.length > 0;

  const target = extractField('TargetContent', 'targetContent', 'target_content', 'target', 'oldContent', 'old_content', 'old', 'search', 'find');
  const replacement = extractField('ReplacementContent', 'replacementContent', 'replacement_content', 'replacement', 'newContent', 'new_content', 'new', 'replace');
  const code = extractField('CodeContent', 'codeContent', 'code_content', 'code', 'FileContents', 'fileContents', 'content');
  const instr = extractField('Instruction', 'instruction', 'Description', 'description');
  const startLineVal = extractField('StartLine', 'startLine', 'start_line');
  const startNum = startLineVal ? parseInt(String(startLineVal), 10) : null;

  if (hasChunks) {
    diffLines.push(`--- a/${fileName}`);
    diffLines.push(`+++ b/${fileName}`);
    chunks.forEach((chunk: any, idx: number) => {
      const t = getArgVal(chunk, 'TargetContent', 'targetContent', 'target_content', 'target', 'oldContent', 'old');
      const r = getArgVal(chunk, 'ReplacementContent', 'replacementContent', 'replacement_content', 'replacement', 'newContent', 'new');
      const cStart = getArgVal(chunk, 'StartLine', 'startLine', 'start_line');
      const cStartNum = cStart ? parseInt(String(cStart), 10) : null;
      const tLines = (t !== undefined && t !== null && String(t).length > 0) ? String(t).split('\n') : [];
      const rLines = (r !== undefined && r !== null && String(r).length > 0) ? String(r).split('\n') : [];
      
      if (cStartNum !== null) {
        diffLines.push(`@@ -${cStartNum},${tLines.length} +${cStartNum},${rLines.length} @@ chunk ${idx + 1}`);
      } else {
        diffLines.push(`@@ chunk ${idx + 1} @@`);
      }
      tLines.forEach((l: string) => diffLines.push(`-${l}`));
      rLines.forEach((l: string) => diffLines.push(`+${l}`));
    });
  } else if (target !== undefined || replacement !== undefined) {
    diffLines.push(`--- a/${fileName}`);
    diffLines.push(`+++ b/${fileName}`);
    const tLines = (target !== undefined && target !== null && String(target).length > 0) ? String(target).split('\n') : [];
    const rLines = (replacement !== undefined && replacement !== null && String(replacement).length > 0) ? String(replacement).split('\n') : [];
    
    if (startNum !== null) {
      diffLines.push(`@@ -${startNum},${tLines.length} +${startNum},${rLines.length} @@${instr ? ' ' + instr : ''}`);
    } else if (instr) {
      diffLines.push(`@@ ${instr} @@`);
    } else {
      diffLines.push(`@@ edit @@`);
    }
    tLines.forEach((l: string) => diffLines.push(`-${l}`));
    rLines.forEach((l: string) => diffLines.push(`+${l}`));
  } else if (code !== undefined && code !== null) {
    diffLines.push(`--- /dev/null`);
    diffLines.push(`+++ b/${fileName}`);
    const cLines = String(code).split('\n');
    diffLines.push(`@@ -0,0 +1,${cLines.length} @@${instr ? ' ' + instr : ' new file'}`);
    cLines.forEach((l: string) => diffLines.push(`+${l}`));
  }

  if (diffLines.length > 0) {
    return diffLines.join('\n');
  }

  if (isFileEditTool(name)) {
    const desc = instr ? ` ${instr}` : ' file edit in progress...';
    return `--- a/${fileName}\n+++ b/${fileName}\n@@${desc} @@`;
  }

  return null;
}

export function renderDiffOrTextHtml(text: string): string {
  if (!isDiffText(text)) {
    return esc(text);
  }

  let cleanText = text;
  if (text.includes('[diff_block_start]')) {
    const match = text.match(/\[diff_block_start\]([\s\S]*?)\[diff_block_end\]/);
    if (match && match[1]) {
      cleanText = match[1].trim();
    } else {
      cleanText = text.replace(/\[\/?diff_block_(start|end)\]/g, '').trim();
    }
  }

  const lines = cleanText.split('\n');
  return lines.map(line => {
    const escaped = esc(line);
    if (line.startsWith('--- ') || line.startsWith('+++ ') || line.startsWith('diff --git') || line.startsWith('index ')) {
      return `<span class="diff-header">${escaped}</span>`;
    }
    if (line.startsWith('@@') || /^@@ -\d+(,\d+)? \+\d+(,\d+)? @@/.test(line)) {
      return `<span class="diff-info">${escaped}</span>`;
    }
    if (line.startsWith('+') && !line.startsWith('+++')) {
      return `<span class="diff-add">${escaped}</span>`;
    }
    if (line.startsWith('-') && !line.startsWith('---')) {
      return `<span class="diff-del">${escaped}</span>`;
    }
    return escaped;
  }).join('\n');
}
