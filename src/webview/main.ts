import { marked } from 'marked';

marked.setOptions({ breaks: true, gfm: true });

declare function acquireVsCodeApi(): any;
const vscode = acquireVsCodeApi();

interface ToolCall {
  id?: string | number;
  name: string;
  args?: Record<string, any> | string;
  result?: string;
  status?: 'running' | 'done' | 'error';
  expanded?: boolean;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  thinking?: string;
  tokens?: {
    input_tokens?: number;
    output_tokens?: number;
    thinking_tokens?: number;
    total_tokens?: number;
  };
  toolCalls?: ToolCall[];
  isStreaming?: boolean;
}

interface SlashOption {
  value: string;
  label: string;
}

interface SlashCommand {
  name: string;
  description: string;
  hasArg?: boolean;
  argHint?: string;
  isSkill?: boolean;
  options?: SlashOption[];
}

interface SlashDisplayItem {
  name: string;
  displayName: string;
  description: string;
  hasArg?: boolean;
  isSkill?: boolean;
  insertValue?: string;
}

let SLASH_COMMANDS: SlashCommand[] = [
  { name: 'new', description: 'start a new conversation' },
  { name: 'clear', description: 'clear chat history' },
  { 
    name: 'model', 
    description: 'set the model', 
    hasArg: true, 
    argHint: '<model-name>',
    options: [
      { value: 'flash-lite', label: 'Gemini 2.5 Flash Lite' },
      { value: 'flash', label: 'Gemini 2.5 Flash' },
      { value: 'pro', label: 'Gemini 2.5 Pro' },
      { value: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash' },
      { value: 'claude-3-5-sonnet', label: 'Claude 3.5 Sonnet' },
    ]
  },
  { 
    name: 'effort', 
    description: 'set reasoning effort', 
    hasArg: true, 
    argHint: 'low | medium | high',
    options: [
      { value: 'low', label: 'Low reasoning effort' },
      { value: 'medium', label: 'Medium reasoning effort' },
      { value: 'high', label: 'High reasoning effort' },
    ]
  },
  { name: 'settings', description: 'open extension settings' },
  { name: 'help', description: 'show available commands' },
];

const savedState = vscode.getState() as { messages?: Message[] } | undefined;
let messages: Message[] = savedState?.messages || [];
let currentStreamingMessage: Message | null = null;
let slashMenuIndex = 0;
let slashFiltered: SlashDisplayItem[] = [];

let attachedImages: string[] = [];

const log = document.getElementById('chat-messages') as HTMLElement;
const input = document.getElementById('prompt-input') as HTMLTextAreaElement;
window.addEventListener('focus', () => {
  input?.focus();
});
const sendBtn = document.getElementById('send-btn') as HTMLButtonElement;
const cancelBtn = document.getElementById('cancel-btn') as HTMLButtonElement;
const newChatBtn = document.getElementById('new-chat-btn') as HTMLButtonElement;
const historyBtn = document.getElementById('history-btn') as HTMLButtonElement;
const historyDropdown = document.getElementById('history-dropdown') as HTMLElement;
const attachImgBtn = document.getElementById('attach-img-btn') as HTMLButtonElement;
const imageBar = document.getElementById('image-attachment-bar') as HTMLElement;
const statusEl = document.getElementById('status-text') as HTMLElement;
const fileChip = document.getElementById('active-file-context') as HTMLElement;
const contextBar = document.getElementById('context-bar') as HTMLElement;
const slashMenu = document.getElementById('slash-menu') as HTMLElement;
const atMenu = document.getElementById('at-menu') as HTMLElement;

let atMenuIndex = 0;
let atFilteredFiles: string[] = [];
let atDebounceTimer: any = null;

attachImgBtn?.addEventListener('click', () => {
  vscode.postMessage({ command: 'selectImage' });
});

input?.addEventListener('paste', (e: ClipboardEvent) => {
  const items = e.clipboardData?.items;
  if (!items) return;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.type.startsWith('image/')) {
      e.preventDefault();
      const file = item.getAsFile();
      if (!file) continue;
      const reader = new FileReader();
      reader.onload = (event) => {
        const dataUrl = event.target?.result as string;
        if (dataUrl) {
          vscode.postMessage({ command: 'savePastedImage', dataUrl });
        }
      };
      reader.readAsDataURL(file);
    }
  }
});

input?.addEventListener('dragover', (e) => {
  e.preventDefault();
});

input?.addEventListener('drop', (e: DragEvent) => {
  const files = e.dataTransfer?.files;
  if (!files || files.length === 0) return;
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (file.type.startsWith('image/')) {
      e.preventDefault();
      const reader = new FileReader();
      reader.onload = (event) => {
        const dataUrl = event.target?.result as string;
        if (dataUrl) {
          vscode.postMessage({ command: 'savePastedImage', dataUrl });
        }
      };
      reader.readAsDataURL(file);
    }
  }
});

input?.addEventListener('input', () => {
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 200) + 'px';
  updateSlashMenu();
  updateAtMenu();
});

input?.addEventListener('keydown', (e) => {
  if (isAtMenuVisible()) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      atMenuIndex = (atMenuIndex + 1) % atFilteredFiles.length;
      renderAtMenu();
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      atMenuIndex = (atMenuIndex - 1 + atFilteredFiles.length) % atFilteredFiles.length;
      renderAtMenu();
      return;
    }
    if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
      e.preventDefault();
      acceptAtItem();
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      hideAtMenu();
      return;
    }
  }

  if (isSlashMenuVisible()) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      slashMenuIndex = (slashMenuIndex + 1) % slashFiltered.length;
      renderSlashMenu();
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      slashMenuIndex = (slashMenuIndex - 1 + slashFiltered.length) % slashFiltered.length;
      renderSlashMenu();
      return;
    }
    if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
      e.preventDefault();
      acceptSlashItem();
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      hideSlashMenu();
      return;
    }
  }

  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendPrompt();
  }
});

sendBtn?.addEventListener('click', sendPrompt);

cancelBtn?.addEventListener('click', () => {
  vscode.postMessage({ command: 'cancel' });
});

newChatBtn?.addEventListener('click', () => {
  messages = [];
  currentStreamingMessage = null;
  renderAll();
  vscode.postMessage({ command: 'newConversation' });
});

historyBtn?.addEventListener('click', (e) => {
  e.stopPropagation();
  if (historyDropdown.style.display === 'block') {
    historyDropdown.style.display = 'none';
  } else {
    historyDropdown.style.display = 'block';
    historyDropdown.innerHTML = '<div class="history-header">Loading sessions...</div>';
    vscode.postMessage({ command: 'getSessions' });
  }
});

document.addEventListener('click', (e) => {
  if (historyDropdown && historyDropdown.style.display === 'block') {
    if (!historyDropdown.contains(e.target as Node) && e.target !== historyBtn) {
      historyDropdown.style.display = 'none';
    }
  }

  const suggestionCard = (e.target as HTMLElement).closest('.suggestion-card');
  if (suggestionCard) {
    const promptText = suggestionCard.getAttribute('data-prompt');
    if (promptText && input) {
      input.value = promptText;
      input.focus();
      adjustInputHeight();
    }
  }
});

log?.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  const anchor = target.closest('a');
  if (anchor) {
    const href = anchor.getAttribute('href');
    if (href) {
      if (!href.startsWith('http://') && !href.startsWith('https://')) {
        e.preventDefault();
        vscode.postMessage({ command: 'openFile', filePath: href });
        return;
      }
    }
  }

  const clickableFile = target.closest('.clickable-file');
  if (clickableFile) {
    const pathAttr = clickableFile.getAttribute('data-path');
    if (pathAttr) {
      vscode.postMessage({ command: 'openFile', filePath: pathAttr });
    }
  }
});

function getSlashMatch(): { prefix: string; query: string } | null {
  const val = input.value;
  const match = val.match(/^\/(\S*)$/);
  if (!match) return null;
  return { prefix: '/', query: match[1] };
}

function isSlashMenuVisible(): boolean {
  return slashMenu?.style.display !== 'none' && slashFiltered.length > 0;
}

function updateSlashMenu() {
  const val = input.value;
  if (!val.startsWith('/')) {
    hideSlashMenu();
    return;
  }

  // Check if command + argument (e.g. /model ... or /effort ...)
  const spaceIndex = val.indexOf(' ');
  if (spaceIndex !== -1) {
    const cmdName = val.slice(1, spaceIndex).toLowerCase();
    const argQuery = val.slice(spaceIndex + 1).toLowerCase();
    const cmd = SLASH_COMMANDS.find(c => c.name === cmdName);
    if (cmd && cmd.options) {
      const matchingOpts = cmd.options.filter(o => o.value.toLowerCase().includes(argQuery) || o.label.toLowerCase().includes(argQuery));
      if (matchingOpts.length > 0) {
        slashFiltered = matchingOpts.map(o => ({
          name: cmd.name,
          displayName: `/${cmd.name} ${o.value}`,
          description: o.label,
          insertValue: `/${cmd.name} ${o.value}`,
        }));
        slashMenuIndex = 0;
        renderSlashMenu();
        if (slashMenu) slashMenu.style.display = 'block';
        return;
      }
    }
    hideSlashMenu();
    return;
  }

  // Matching top-level command (e.g. / or /mod)
  const q = val.slice(1).toLowerCase();
  const matchedCmds = SLASH_COMMANDS.filter(c => c.name.startsWith(q));
  if (matchedCmds.length === 0) {
    hideSlashMenu();
    return;
  }

  slashFiltered = matchedCmds.map(c => ({
    name: c.name,
    displayName: `/${c.name}`,
    description: c.description + (c.argHint ? ` ${c.argHint}` : ''),
    hasArg: c.hasArg,
    isSkill: c.isSkill,
  }));
  slashMenuIndex = 0;
  renderSlashMenu();
  if (slashMenu) slashMenu.style.display = 'block';
}

function renderSlashMenu() {
  if (!slashMenu) return;
  slashMenu.innerHTML = '';
  slashFiltered.forEach((cmd, i) => {
    const row = document.createElement('div');
    row.className = 'slash-item' + (i === slashMenuIndex ? ' active' : '');
    const badgeHtml = cmd.isSkill ? `<span class="slash-badge">skill</span>` : '';
    row.innerHTML = `<span class="slash-name">${esc(cmd.displayName)}</span>${badgeHtml}<span class="slash-desc">${esc(cmd.description)}</span>`;
    row.addEventListener('mouseenter', () => {
      slashMenuIndex = i;
      const items = slashMenu.querySelectorAll('.slash-item');
      items.forEach((el, idx) => {
        el.classList.toggle('active', idx === slashMenuIndex);
      });
    });
    row.addEventListener('mousedown', (e) => {
      e.preventDefault();
      slashMenuIndex = i;
      acceptSlashItem();
    });
    slashMenu.appendChild(row);
  });

  const activeEl = slashMenu.querySelector('.slash-item.active') as HTMLElement;
  if (activeEl) {
    activeEl.scrollIntoView({ block: 'nearest' });
  }
}

function acceptSlashItem() {
  const item = slashFiltered[slashMenuIndex];
  if (!item) return;
  if (item.insertValue) {
    input.value = '';
    hideSlashMenu();
    const match = item.insertValue.match(/^\/(\S+)\s*(.*)?$/);
    if (match) {
      executeSlashCommand(match[1], match[2] || undefined);
    }
  } else if (item.hasArg) {
    input.value = `/${item.name} `;
    hideSlashMenu();
    updateSlashMenu();
    input.focus();
  } else {
    input.value = '';
    hideSlashMenu();
    executeSlashCommand(item.name);
  }
}

function hideSlashMenu() {
  if (slashMenu) slashMenu.style.display = 'none';
  slashFiltered = [];
}

function getAtMatch(): { start: number; end: number; query: string } | null {
  if (!input) return null;
  const cursor = input.selectionStart;
  const textBeforeCursor = input.value.slice(0, cursor);
  const match = textBeforeCursor.match(/(?:^|\s)@([^\s@]*)$/);
  if (!match) return null;
  const atIndex = textBeforeCursor.lastIndexOf('@');
  if (atIndex < 0) return null;
  return {
    start: atIndex,
    end: cursor,
    query: match[1],
  };
}

function isAtMenuVisible(): boolean {
  return atMenu?.style.display !== 'none' && atFilteredFiles.length > 0;
}

function updateAtMenu() {
  const match = getAtMatch();
  if (!match) {
    hideAtMenu();
    return;
  }
  if (atDebounceTimer) clearTimeout(atDebounceTimer);
  atDebounceTimer = setTimeout(() => {
    vscode.postMessage({ command: 'searchFiles', query: match.query });
  }, 100);
}

function hideAtMenu() {
  if (atMenu) atMenu.style.display = 'none';
  atFilteredFiles = [];
}

function renderAtMenu() {
  if (!atMenu) return;
  atMenu.innerHTML = '';
  if (atFilteredFiles.length === 0) {
    atMenu.style.display = 'none';
    return;
  }

  atFilteredFiles.forEach((file, i) => {
    const row = document.createElement('div');
    row.className = 'at-item' + (i === atMenuIndex ? ' active' : '');
    row.innerHTML = `<span class="at-icon">@</span><span class="at-path">${esc(file)}</span>`;
    row.addEventListener('mouseenter', () => {
      atMenuIndex = i;
      const items = atMenu.querySelectorAll('.at-item');
      items.forEach((el, idx) => {
        el.classList.toggle('active', idx === atMenuIndex);
      });
    });
    row.addEventListener('mousedown', (e) => {
      e.preventDefault();
      atMenuIndex = i;
      acceptAtItem();
    });
    atMenu.appendChild(row);
  });
  atMenu.style.display = 'block';

  const activeEl = atMenu.querySelector('.at-item.active') as HTMLElement;
  if (activeEl) {
    activeEl.scrollIntoView({ block: 'nearest' });
  }
}

function acceptAtItem() {
  const file = atFilteredFiles[atMenuIndex];
  if (!file) return;
  const match = getAtMatch();
  if (!match) return;

  const before = input.value.slice(0, match.start);
  const after = input.value.slice(match.end);
  const replacement = `@${file} `;
  input.value = before + replacement + after;
  const newCursorPos = before.length + replacement.length;
  input.setSelectionRange(newCursorPos, newCursorPos);

  hideAtMenu();
  input.focus();
}

function executeSlashCommand(name: string, arg?: string) {
  if (name === 'clear') {
    messages = [];
    currentStreamingMessage = null;
    renderAll();
  }
  if (name === 'new') {
    messages = [];
    currentStreamingMessage = null;
    renderAll();
  }
  vscode.postMessage({ command: 'slashCommand', name, arg });
}

function sendPrompt() {
  const text = input.value.trim();
  if (!text && attachedImages.length === 0) return;

  hideSlashMenu();

  const slashMatch = text.match(/^\/(\S+)\s*(.*)?$/);
  if (slashMatch) {
    const cmdName = slashMatch[1];
    const cmdArg = slashMatch[2]?.trim() || undefined;
    const known = SLASH_COMMANDS.find(c => c.name === cmdName);
    if (known) {
      input.value = '';
      input.style.height = 'auto';
      executeSlashCommand(cmdName, cmdArg);
      return;
    }
  }

  const imagesToSend = [...attachedImages];
  attachedImages = [];
  renderImageBar();

  let displayText = text;
  if (imagesToSend.length > 0) {
    const imgLabels = imagesToSend.map(p => `[Image: ${p.split(/[\/\\]/).pop()}]`).join(' ');
    displayText = displayText ? `${imgLabels}\n${displayText}` : imgLabels;
  }

  messages.push({
    id: `u-${Date.now()}`,
    role: 'user',
    text: displayText,
  });

  input.value = '';
  input.style.height = 'auto';

  currentStreamingMessage = {
    id: `a-${Date.now()}`,
    role: 'assistant',
    text: '',
    thinking: '',
    toolCalls: [],
    isStreaming: true,
  };
  messages.push(currentStreamingMessage);

  renderAll(true);
  setBusy(true);

  vscode.postMessage({
    command: 'sendPrompt',
    text,
    images: imagesToSend.length > 0 ? imagesToSend : undefined,
  });
}

function renderImageBar() {
  if (!imageBar) return;
  if (attachedImages.length === 0) {
    imageBar.style.display = 'none';
    imageBar.innerHTML = '';
    return;
  }
  imageBar.innerHTML = '';
  imageBar.style.display = 'flex';
  attachedImages.forEach((imgUri, idx) => {
    const filename = imgUri.split(/[\/\\]/).pop() || 'image.png';
    const chip = document.createElement('div');
    chip.className = 'img-chip';
    chip.innerHTML = `<span class="img-chip-name" title="${esc(imgUri)}">&#128444; ${esc(filename)}</span><button class="img-chip-remove" title="Remove">&times;</button>`;
    chip.querySelector('.img-chip-remove')?.addEventListener('click', () => {
      attachedImages.splice(idx, 1);
      renderImageBar();
    });
    imageBar.appendChild(chip);
  });
}

function setBusy(busy: boolean) {
  if (sendBtn) sendBtn.style.display = busy ? 'none' : 'inline';
  if (cancelBtn) cancelBtn.style.display = busy ? 'inline' : 'none';
  if (statusEl) {
    statusEl.textContent = busy ? 'thinking...' : 'enter to send, shift+enter for newline';
    statusEl.className = busy ? 'input-hint status-indicator active' : 'input-hint status-indicator';
  }
}

function toPascalCaseName(name: string): string {
  if (!name) return 'Tool';
  const nameMap: Record<string, string> = {
    list_dir: 'ListDir',
    list_directory: 'ListDir',
    view_file: 'ReadFile',
    read_file: 'ReadFile',
    run_command: 'RunCommand',
    grep_search: 'GrepSearch',
    replace_file_content: 'ReplaceFileContent',
    multi_replace_file_content: 'MultiReplaceFileContent',
    write_to_file: 'WriteFile',
    search_web: 'SearchWeb',
    read_url_content: 'ReadUrl',
    ask_question: 'AskQuestion',
    ask_permission: 'AskPermission',
  };
  const key = name.toLowerCase();
  if (nameMap[key]) return nameMap[key];
  return name.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('');
}
function cleanValue(val: any): any {
  if (typeof val !== 'string') return val;
  let s = val.trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    try {
      const parsed = JSON.parse(s);
      if (typeof parsed === 'string') s = parsed;
    } catch {
      s = s.slice(1, -1);
    }
  }
  return s.replace(/\\\\/g, '\\');
}

function formatToolArgsForDisplay(toolName: string, rawArgs: any): { html?: string; text: string } {
  let argsObj: any = rawArgs;
  if (typeof rawArgs === 'string') {
    try {
      argsObj = JSON.parse(rawArgs);
    } catch {
      argsObj = rawArgs;
    }
  }

  if (typeof argsObj !== 'object' || !argsObj) {
    return { text: String(cleanValue(rawArgs || '')) };
  }

  const cleaned: Record<string, any> = {};
  for (const k of Object.keys(argsObj)) {
    cleaned[k] = cleanValue(argsObj[k]);
  }

  const normName = (toolName || '').toLowerCase().replace(/[-_]/g, '');

  if (normName === 'runcommand' || normName === 'exec' || normName === 'terminal') {
    const cmd = cleaned.CommandLine || cleaned.commandLine || cleaned.command || cleaned.cmd || '';
    const cwd = cleaned.Cwd || cleaned.cwd || cleaned.directory || '';
    const action = cleaned.toolAction || cleaned.toolSummary || cleaned.description || '';

    let html = '<div class="formatted-args-container">';
    if (cmd) {
      html += `<div class="formatted-arg-row"><span class="arg-label">Command:</span><code class="arg-cmd-code">${escapeHtml(cmd)}</code></div>`;
    }
    if (cwd) {
      const normCwd = String(cwd).replace(/\\/g, '/');
      html += `<div class="formatted-arg-row"><span class="arg-label">Directory:</span><span class="arg-val">${escapeHtml(normCwd)}</span></div>`;
    }
    if (action && action !== cmd) {
      html += `<div class="formatted-arg-row"><span class="arg-label">Action:</span><span class="arg-val">${escapeHtml(action)}</span></div>`;
    }
    html += '</div>';

    return { html, text: cmd || JSON.stringify(cleaned, null, 2) };
  }

  delete cleaned.BypassSandbox;
  delete cleaned.WaitMsBeforeAsync;

  return { text: JSON.stringify(cleaned, null, 2) };
}
function formatToolSummary(tc: ToolCall): { text: string; isFile: boolean } {
  let args = tc.args;
  if (typeof args === 'string') {
    try { args = JSON.parse(args); } catch {}
  }
  if (!args || (typeof args === 'object' && Object.keys(args).length === 0)) {
    if (tc.result && typeof tc.result === 'string') {
      const firstLine = tc.result.trim().split('\n')[0];
      if (firstLine) return { text: firstLine.slice(0, 60), isFile: false };
    }
    return { text: '', isFile: false };
  }
  if (typeof args !== 'object') return { text: String(args), isFile: false };

  const action = args.Action || args.action;
  const target = args.Target || args.target;
  if (action || target) {
    const parts: string[] = [];
    if (action) parts.push(`Action: ${action}`);
    if (target) parts.push(`Target: ${target}`);
    return { text: parts.join(', '), isFile: false };
  }

  const cmd = args.CommandLine || args.command || args.cmd || args.CommandLineString || args.script;
  if (cmd) {
    const cleanCmd = String(cmd).replace(/^"|"$/g, '');
    return { text: cleanCmd, isFile: false };
  }

  const file = args.TargetFile || args.targetFile || args.file_path || args.path || args.SearchPath || args.AbsolutePath || args.DirectoryPath || args.target_file || args.file;
  if (file) {
    const cleanFile = String(file).replace(/^"|"$/g, '');
    return { text: cleanFile, isFile: true };
  }

  const query = args.Query || args.query || args.pattern || args.Prompt || args.prompt;
  if (query) {
    const cleanQuery = String(query).replace(/^"|"$/g, '');
    return { text: `"${cleanQuery}"`, isFile: false };
  }

  const url = args.Url || args.url || args.URI || args.uri;
  if (url) {
    return { text: String(url), isFile: false };
  }

  const keys = Object.keys(args);
  if (keys.length === 0) return { text: '', isFile: false };
  return {
    text: keys.slice(0, 2).map(k => `${k}: ${String(args[k]).replace(/^"|"$/g, '').slice(0, 30)}`).join(', '),
    isFile: false
  };
}

function renderEmptyState() {
  if (!log) return;
  log.innerHTML = `
    <div id="empty-state" class="empty-state">
      <div class="empty-state-hero">
        <svg class="empty-state-logo-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 112 112" fill="none">
          <path d="M89.6992 93.695C94.3659 97.195 101.366 94.8617 94.9492 88.445C75.6992 69.7783 79.7825 18.445 55.8659 18.445C31.9492 18.445 36.0325 69.7783 16.7825 88.445C9.78251 95.445 17.3658 97.195 22.0325 93.695C40.1159 81.445 38.9492 59.8617 55.8659 59.8617C72.7825 59.8617 71.6159 81.445 89.6992 93.695Z" fill="#3186FF"/>
          <mask id="empty_mask0" style="mask-type:alpha" maskUnits="userSpaceOnUse" x="13" y="18" width="85" height="78">
            <path d="M89.6992 93.695C94.3659 97.195 101.366 94.8617 94.9492 88.445C75.6992 69.7783 79.7825 18.445 55.8659 18.445C31.9492 18.445 36.0325 69.7783 16.7825 88.445C9.78251 95.445 17.3658 97.195 22.0325 93.695C40.1159 81.445 38.9492 59.8617 55.8659 59.8617C72.7825 59.8617 71.6159 81.445 89.6992 93.695Z" fill="black"/>
          </mask>
          <g mask="url(#empty_mask0)">
            <g filter="url(#f0_empty)"><ellipse cx="22.7873" cy="26.8098" rx="22.7873" ry="26.8098" transform="matrix(-0.112784 0.99362 -0.99362 -0.112781 66.2473 -15.5344)" fill="#FFE432"/></g>
            <g filter="url(#f1_empty)"><ellipse cx="96.491" cy="35.1231" rx="29.5007" ry="30.1492" transform="rotate(76.9243 96.491 35.1231)" fill="#FC413D"/></g>
            <g filter="url(#f2_empty)"><ellipse cx="9.02988" cy="41.6647" rx="30.832" ry="39.9417" transform="rotate(74.1257 9.02988 41.6647)" fill="#00B95C"/></g>
            <g filter="url(#f3_empty)"><ellipse cx="11.2212" cy="42.8915" rx="30.22" ry="33.2695" transform="rotate(45.6065 11.2212 42.8915)" fill="#00B95C"/></g>
            <g filter="url(#f4_empty)"><ellipse cx="75.7546" cy="104.822" rx="29.0177" ry="27.943" transform="rotate(76.9243 75.7546 104.822)" fill="#3186FF"/></g>
            <g filter="url(#f5_empty)"><ellipse cx="33.5661" cy="35.4043" rx="33.5661" ry="35.4043" transform="matrix(-0.409539 0.912293 -0.912294 -0.409537 101.25 -15.1674)" fill="#FBBC04"/></g>
            <g filter="url(#f6_empty)"><path d="M2.56802 149.695C-15.8116 142.48 15.5987 83.1163 23.4093 63.2203C31.22 43.3244 52.4514 33.0447 70.831 40.26C89.2107 47.4753 110.996 87.2162 103.185 107.112C95.3742 127.008 20.9477 156.91 2.56802 149.695Z" fill="#3186FF"/></g>
            <g filter="url(#f7_empty)"><path d="M113.934 75.8079C109.013 81.5509 96.1724 78.6224 85.253 69.2667C74.3335 59.911 69.4704 47.6711 74.391 41.928C79.3116 36.185 92.1525 39.1136 103.072 48.4692C113.991 57.8249 118.855 70.0648 113.934 75.8079Z" fill="#749BFF"/></g>
            <g filter="url(#f8_empty)"><ellipse cx="92.611" cy="23.7962" rx="44.2411" ry="27.5016" transform="rotate(34.0763 92.611 23.7962)" fill="#FC413D"/></g>
            <g filter="url(#f9_empty)"><ellipse cx="23.4949" cy="29.5887" rx="23.7071" ry="13.7869" transform="rotate(112.516 23.4949 29.5887)" fill="#FFEE48"/></g>
          </g>
          <defs>
            <filter id="f0_empty" x="2.49" y="-26.54" width="69.09" height="61.25" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="3.89"/></filter>
            <filter id="f1_empty" x="28.75" y="-32.03" width="135.48" height="134.31" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="18.81"/></filter>
            <filter id="f2_empty" x="-62.29" y="-21.93" width="142.64" height="127.18" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="15.99"/></filter>
            <filter id="f3_empty" x="-34.25" y="-3.45" width="90.94" height="92.68" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="12.00"/></filter>
            <filter id="f4_empty" x="28.02" y="56.78" width="95.47" height="96.08" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="10.00"/></filter>
            <filter id="f5_empty" x="2.49" y="-26.54" width="69.09" height="61.25" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="3.89"/></filter>
            <filter id="f6_empty" x="-20" y="20" width="140" height="150" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="10.00"/></filter>
            <filter id="f7_empty" x="50" y="20" width="80" height="80" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="8.00"/></filter>
            <filter id="f8_empty" x="40" y="-10" width="105" height="70" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="12.00"/></filter>
            <filter id="f9_empty" x="0" y="0" width="50" height="60" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="5.00"/></filter>
          </defs>
        </svg>
        <div class="empty-state-title">Antigravity</div>
        <div class="empty-state-subtitle">How can I help you build today?</div>
      </div>
      <div class="empty-state-suggestions">
        <button class="suggestion-card" data-prompt="Explain the architecture of this workspace">
          <span class="card-icon">🔍</span>
          <span class="card-text">Explain workspace architecture</span>
        </button>
        <button class="suggestion-card" data-prompt="Help me write unit tests for this project">
          <span class="card-icon">🧪</span>
          <span class="card-text">Write unit tests</span>
        </button>
        <button class="suggestion-card" data-prompt="Find potential bugs or performance bottlenecks">
          <span class="card-icon">⚡</span>
          <span class="card-text">Audit bugs & performance</span>
        </button>
        <button class="suggestion-card" data-prompt="/plan Plan step-by-step feature implementation">
          <span class="card-icon">📋</span>
          <span class="card-text">Plan feature implementation</span>
        </button>
      </div>
    </div>
  `;
}

function renderAll(autoScrollForce: boolean = false) {
  if (!log) return;
  const wasAtBottom = (log.scrollHeight - log.scrollTop - log.clientHeight) <= 80;
  
  if (messages.length === 0) {
    renderEmptyState();
    return;
  }

  log.innerHTML = '';

  for (const msg of messages) {
    const el = document.createElement('div');
    el.className = `msg msg-${msg.role}`;

    const role = document.createElement('div');
    role.className = `msg-role ${msg.role}`;
    role.textContent = msg.role === 'user' ? 'you' : 'antigravity';
    el.appendChild(role);

    if (msg.role === 'assistant' && msg.thinking && msg.thinking.trim()) {
      el.appendChild(renderThinking(msg.thinking, msg.isStreaming));
    }

    if (msg.toolCalls && msg.toolCalls.length > 0) {
      const toolSection = document.createElement('div');
      toolSection.className = 'tool-section';

      for (const tc of msg.toolCalls) {
        const accordion = document.createElement('div');
        accordion.className = `tool-accordion${tc.expanded ? ' open' : ''}`;

        const header = document.createElement('div');
        header.className = `tool-header${tc.expanded ? ' open' : ''}`;

        const statusIcon = document.createElement('span');
        const statusClass = tc.status || 'done';
        statusIcon.className = `tool-status-icon ${statusClass}`;
        statusIcon.innerHTML = statusClass === 'running' ? '&#9696;' : statusClass === 'error' ? '&#10007;' : '&#9679;';

        const callSigEl = document.createElement('span');
        callSigEl.className = 'tool-call-sig';

        const nameEl = document.createElement('span');
        nameEl.className = 'tool-name';
        nameEl.textContent = toPascalCaseName(tc.name);
        callSigEl.appendChild(nameEl);

        const summary = formatToolSummary(tc);
        const argsText = summary.text ? summary.text : '';

        if (argsText) {
          const summaryEl = document.createElement('span');
          summaryEl.className = 'tool-summary';
          if (summary.isFile) {
            summaryEl.innerHTML = `(<span class="clickable-file" data-path="${esc(argsText)}" title="Click to open in editor">${esc(argsText)}</span>)`;
          } else {
            summaryEl.textContent = `(${argsText})`;
          }
          callSigEl.appendChild(summaryEl);
        }

        const hintEl = document.createElement('span');
        hintEl.className = 'tool-expand-hint';
        hintEl.textContent = tc.expanded ? '▼' : '(click to expand)';

        header.appendChild(statusIcon);
        header.appendChild(callSigEl);
        header.appendChild(hintEl);

        const body = document.createElement('div');
        body.className = `tool-body${tc.expanded ? ' open' : ''}`;

        const bodyInner = document.createElement('div');
        bodyInner.className = 'tool-body-inner';

        let hasContent = false;

        const diffStr = buildDiffFromToolArgs(tc.name, tc.args, tc.result);
        if (diffStr) {
          hasContent = true;
          const diffBlock = document.createElement('div');
          diffBlock.className = 'tool-diff-block';

          const diffHeader = document.createElement('div');
          diffHeader.className = 'tool-block-header';

          const title = document.createElement('div');
          title.className = 'tool-block-title';
          title.textContent = 'Changes (Diff)';
          diffHeader.appendChild(title);

          const targetFile = extractTargetFile(tc.name, tc.args, tc.result);
          if (targetFile) {
            const openDiffBtn = document.createElement('button');
            openDiffBtn.className = 'open-diff-btn';
            openDiffBtn.textContent = 'Compare in Editor ↗';
            openDiffBtn.title = 'Open side-by-side diff in editor grid';
            openDiffBtn.onclick = (e) => {
              e.stopPropagation();
              vscode.postMessage({
                command: 'openDiffView',
                targetFile: targetFile,
                toolName: tc.name,
                toolArgs: tc.args,
              });
            };
            diffHeader.appendChild(openDiffBtn);
          }

          diffBlock.appendChild(diffHeader);

          const pre = document.createElement('pre');
          pre.className = 'tool-json-pre';
          pre.innerHTML = renderDiffOrTextHtml(diffStr);
          diffBlock.appendChild(pre);
          bodyInner.appendChild(diffBlock);
        }

        const normToolName = (tc.name || '').toLowerCase().replace(/[-_]/g, '');
        const isFileEditTool = normToolName.includes('replacefilecontent') || normToolName.includes('writetofile') || normToolName.includes('writefile');

        if (!diffStr && !isFileEditTool && tc.args && (typeof tc.args === 'string' || (typeof tc.args === 'object' && Object.keys(tc.args).length > 0))) {
          hasContent = true;
          const argsBlock = document.createElement('div');
          argsBlock.className = 'tool-args-block';
          const title = document.createElement('div');
          title.className = 'tool-block-title';
          title.textContent = 'Arguments';
          argsBlock.appendChild(title);

          const formatted = formatToolArgsForDisplay(tc.name, tc.args);
          if (formatted.html) {
            const container = document.createElement('div');
            container.innerHTML = formatted.html;
            argsBlock.appendChild(container);
          } else {
            const pre = document.createElement('pre');
            pre.className = 'tool-json-pre';
            pre.textContent = formatted.text;
            argsBlock.appendChild(pre);
          }
          bodyInner.appendChild(argsBlock);
        }

        if (tc.result !== undefined && tc.result !== null && String(tc.result).trim() !== '') {
          let rawResultStr = typeof tc.result === 'string' ? tc.result : JSON.stringify(tc.result, null, 2);
          const hasDiffBlock = rawResultStr.includes('[diff_block_start]');
          
          const cleanOutputText = hasDiffBlock
            ? rawResultStr.replace(/\[diff_block_start\][\s\S]*?\[diff_block_end\]/g, '').replace(/The following changes were made by the \w+ tool to:[^\n]*/g, '').trim()
            : (diffStr && isDiffText(rawResultStr) ? '' : rawResultStr.trim());

          if (cleanOutputText) {
            hasContent = true;
            const resultBlock = document.createElement('div');
            resultBlock.className = 'tool-result-block';
            const title = document.createElement('div');
            title.className = 'tool-block-title';
            title.textContent = 'Output';
            resultBlock.appendChild(title);

            const pre = document.createElement('pre');
            pre.className = 'tool-json-pre';
            let formattedResult: any = cleanOutputText;
            try {
              const parsed = JSON.parse(cleanOutputText);
              formattedResult = JSON.stringify(parsed, null, 2);
            } catch {}
            if (typeof formattedResult === 'string') {
              pre.innerHTML = renderDiffOrTextHtml(formattedResult);
            } else {
              pre.textContent = String(formattedResult);
            }
            resultBlock.appendChild(pre);

            if (typeof formattedResult === 'string' && (formattedResult.includes('[Permission Required]') || formattedResult.includes('User denied permission to run command:'))) {
              const match = formattedResult.match(/(?:Command '|User denied permission to run command:\s*)([^'\n]+)/i);
              const rawCmd = match ? match[1].trim() : '';
              const cmd = rawCmd.replace(/^['"]|['"]$/g, '').trim();

              const actionBar = document.createElement('div');
              actionBar.className = 'perm-action-bar';
              actionBar.style.cssText = 'margin-top: 8px; display: flex; gap: 8px; flex-wrap: wrap; align-items: center;';

              if (cmd) {
                const displayCmd = cmd.length > 28 ? cmd.substring(0, 25) + '...' : cmd;
                const yesBtn = document.createElement('button');
                yesBtn.className = 'perm-btn perm-btn-primary';
                yesBtn.style.cssText = 'padding: 4px 10px; font-size: 11px; width: auto;';
                yesBtn.textContent = `✓ Yes for '${displayCmd}'`;
                yesBtn.addEventListener('click', (e) => {
                  e.stopPropagation();
                  yesBtn.disabled = true;
                  yesBtn.textContent = `✓ Yes for '${displayCmd}' - resuming...`;
                  if (sessionBtn) sessionBtn.disabled = true;
                  if (noBtn) noBtn.disabled = true;

                  currentStreamingMessage = {
                    id: `a-${Date.now()}`,
                    role: 'assistant',
                    text: '',
                    thinking: '',
                    toolCalls: [],
                    isStreaming: true,
                  };
                  messages.push(currentStreamingMessage);
                  renderAll(true);
                  setBusy(true);

                  vscode.postMessage({ command: 'permissionResponse', choice: 'yes' });
                });
                actionBar.appendChild(yesBtn);

                const sessionBtn = document.createElement('button');
                sessionBtn.className = 'perm-btn perm-btn-secondary';
                sessionBtn.style.cssText = 'padding: 4px 10px; font-size: 11px; width: auto;';
                sessionBtn.textContent = '✓ Yes for all commands in this session';
                sessionBtn.addEventListener('click', (e) => {
                  e.stopPropagation();
                  sessionBtn.disabled = true;
                  sessionBtn.textContent = '✓ Yes for session - resuming...';
                  if (yesBtn) yesBtn.disabled = true;
                  if (noBtn) noBtn.disabled = true;

                  currentStreamingMessage = {
                    id: `a-${Date.now()}`,
                    role: 'assistant',
                    text: '',
                    thinking: '',
                    toolCalls: [],
                    isStreaming: true,
                  };
                  messages.push(currentStreamingMessage);
                  renderAll(true);
                  setBusy(true);

                  vscode.postMessage({ command: 'permissionResponse', choice: 'session' });
                });
                actionBar.appendChild(sessionBtn);

                const noBtn = document.createElement('button');
                noBtn.className = 'perm-btn perm-btn-cancel';
                noBtn.style.cssText = 'padding: 4px 10px; font-size: 11px; width: auto;';
                noBtn.textContent = '✕ No';
                noBtn.addEventListener('click', (e) => {
                  e.stopPropagation();
                  noBtn.disabled = true;
                  if (yesBtn) yesBtn.disabled = true;
                  if (sessionBtn) sessionBtn.disabled = true;
                  setBusy(false);
                  vscode.postMessage({ command: 'permissionResponse', choice: 'no' });
                });
                actionBar.appendChild(noBtn);

                const copyBtn = document.createElement('button');
                copyBtn.className = 'perm-btn perm-btn-secondary';
                copyBtn.style.cssText = 'padding: 4px 10px; font-size: 11px; width: auto;';
                copyBtn.textContent = '📋 Copy Command';
                copyBtn.addEventListener('click', (e) => {
                  e.stopPropagation();
                  copyTextToClipboard(cmd, copyBtn);
                });
                actionBar.appendChild(copyBtn);
              }

              resultBlock.appendChild(actionBar);
            }

            bodyInner.appendChild(resultBlock);
          }
        }

        if (!hasContent) {
          const emptyInfo = document.createElement('div');
          emptyInfo.className = 'tool-empty-info';
          emptyInfo.style.color = 'var(--text-secondary)';
          emptyInfo.style.fontStyle = 'italic';
          emptyInfo.style.fontSize = '11px';
          emptyInfo.textContent = 'No detailed arguments or output recorded.';
          bodyInner.appendChild(emptyInfo);
        }

        body.appendChild(bodyInner);

        header.addEventListener('click', (e) => {
          const target = e.target as HTMLElement;
          if (target.classList.contains('clickable-file')) return;

          tc.expanded = !tc.expanded;
          hintEl.textContent = tc.expanded ? '▼' : '(click to expand)';
          body.classList.toggle('open', tc.expanded);
          header.classList.toggle('open', tc.expanded);
          accordion.classList.toggle('open', tc.expanded);
          if (tc.expanded) {
            setTimeout(() => {
              accordion.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }, 100);
          }
        });

        accordion.appendChild(header);
        accordion.appendChild(body);
        toolSection.appendChild(accordion);
      }
      el.appendChild(toolSection);
    }

    const body = document.createElement('div');
    body.className = 'msg-body';
    if (msg.role === 'assistant' && msg.text) {
      body.innerHTML = marked.parse(msg.text) as string;
      applyDiffHighlighting(body);
      if (msg.isStreaming) {
        body.classList.add('streaming-cursor');
      }
    } else {
      body.textContent = msg.text;
    }
    el.appendChild(body);

    if (msg.tokens && (msg.tokens.input_tokens || msg.tokens.output_tokens)) {
      const usage = document.createElement('div');
      usage.className = 'usage-bar';
      const parts = [`in: ${msg.tokens.input_tokens || 0}`, `out: ${msg.tokens.output_tokens || 0}`];
      if (msg.tokens.thinking_tokens) parts.push(`think: ${msg.tokens.thinking_tokens}`);
      usage.textContent = parts.join(' / ');
      el.appendChild(usage);
    }

    log.appendChild(el);
  }

  attachCopyButtons(log);
  attachInlineCodeCopyHandlers(log);

  requestAnimationFrame(() => {
    if (autoScrollForce || wasAtBottom) {
      log.scrollTop = log.scrollHeight;
    }
  });

  const toSave = messages.filter(m => !m.isStreaming);
  vscode.setState({ messages: toSave });
}

function attachCopyButtons(container: HTMLElement) {
  const preElements = container.querySelectorAll('pre');
  preElements.forEach((pre) => {
    if (pre.querySelector('.copy-code-btn')) return;

    pre.style.position = 'relative';

    const copyBtn = document.createElement('button');
    copyBtn.className = 'copy-code-btn';
    copyBtn.type = 'button';
    copyBtn.title = 'Copy code block';
    copyBtn.textContent = 'Copy';

    copyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      let textToCopy = '';
      const codeEl = pre.querySelector('code');
      if (codeEl) {
        textToCopy = codeEl.textContent || '';
      } else {
        const clone = pre.cloneNode(true) as HTMLElement;
        const btnInClone = clone.querySelector('.copy-code-btn');
        if (btnInClone) btnInClone.remove();
        textToCopy = clone.textContent || '';
      }
      copyTextToClipboard(textToCopy.trim(), copyBtn);
    });

    pre.appendChild(copyBtn);
  });
}

function isCopyableInlineCode(text: string): boolean {
  const t = text.trim();
  if (!t || t.length < 2) return false;

  if (/^(true|false|null|undefined|void|any|string|number|boolean|object|const|let|var|if|else|return|export|import|from|[;,.:{}()\[\]=+-/*<>!&|]+)$/i.test(t)) {
    return false;
  }

  if (t.includes(' ') || t.startsWith('-') || t.startsWith('./') || t.startsWith('/') || t.startsWith('\\')) {
    return true;
  }

  const cliTools = /^(git|npm|npx|pnpm|yarn|node|python|pip|cargo|docker|kubectl|agy|code|cat|grep|ls|cd|mkdir|rm|cp|mv|find|ssh|curl|wget|bash|powershell|sh)$/i;
  if (cliTools.test(t)) return true;

  if (/\.[a-zA-Z0-9]+$/.test(t) || t.includes('/')) return true;

  return false;
}

function attachInlineCodeCopyHandlers(container: HTMLElement) {
  const inlineCodes = container.querySelectorAll('.msg-body code:not(pre code)');
  inlineCodes.forEach((code) => {
    if ((code as HTMLElement).dataset.hasCopyHandler) return;
    (code as HTMLElement).dataset.hasCopyHandler = 'true';

    const text = code.textContent || '';
    if (!isCopyableInlineCode(text)) return;

    (code as HTMLElement).classList.add('copyable-inline');
    (code as HTMLElement).title = 'Click to copy';
    code.addEventListener('click', (e) => {
      e.stopPropagation();
      const textToCopy = code.textContent || '';
      if (!textToCopy.trim()) return;

      copyTextToClipboard(textToCopy.trim());
      const originalText = code.textContent;
      code.textContent = 'Copied!';
      setTimeout(() => {
        code.textContent = originalText;
      }, 1000);
    });
  });
}

function copyTextToClipboard(text: string, btn?: HTMLButtonElement) {
  if (!text) return;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).catch(() => {
      vscode.postMessage({ type: 'copyToClipboard', text });
    });
  } else {
    vscode.postMessage({ type: 'copyToClipboard', text });
  }

  if (btn) {
    const originalText = btn.textContent || 'Copy';
    btn.textContent = 'Copied!';
    btn.classList.add('copied');
    setTimeout(() => {
      btn.textContent = originalText;
      btn.classList.remove('copied');
    }, 1500);
  }
}

function renderThinking(text: string, isStreaming?: boolean): HTMLElement {
  const section = document.createElement('div');
  section.className = 'thinking-section';

  const toggle = document.createElement('button');
  toggle.className = 'thinking-toggle';
  const lines = text.trim().split('\n').length;
  const statusLabel = isStreaming ? 'thinking...' : `thinking (${lines} line${lines === 1 ? '' : 's'})`;
  toggle.innerHTML = `<span class="thinking-chevron">&#9656;</span> ${esc(statusLabel)}`;

  const body = document.createElement('div');
  body.className = 'thinking-body';
  body.textContent = text;

  toggle.addEventListener('click', () => {
    const open = body.classList.toggle('open');
    toggle.querySelector('.thinking-chevron')!.classList.toggle('open', open);
  });

  section.appendChild(toggle);
  section.appendChild(body);
  return section;
}

function esc(s: string): string {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function isDiffText(text: string): boolean {
  if (!text || typeof text !== 'string') return false;
  const lines = text.split('\n');

  for (const line of lines) {
    if (
      line.startsWith('diff --git') ||
      line.startsWith('index ') ||
      (line.startsWith('--- ') && lines.some(l => l.startsWith('+++ '))) ||
      /^@@ -\d+(,\d+)? \+\d+(,\d+)? @@/.test(line) ||
      line.startsWith('@@ ')
    ) {
      return true;
    }
  }

  return false;
}

function extractTargetFile(toolName: string, rawArgs: any, rawResult?: any): string | undefined {
  let args = rawArgs;
  if (typeof args === 'string') {
    try { args = JSON.parse(args); } catch {}
  }
  if (typeof args === 'object' && args) {
    const file = args.TargetFile || args.targetFile || args.target_file || args.path || args.file;
    if (file && typeof file === 'string') return file;
  }
  if (rawResult && typeof rawResult === 'string') {
    const match = rawResult.match(/(?:to|file):\s*([^\s\n\.\,\:]+\.[a-zA-Z0-9]+)/i) || rawResult.match(/(?:\-\-\-\s*a\/|\+\+\+\s*b\/)([^\s\n]+)/);
    if (match && match[1]) return match[1];
  }
  return undefined;
}

function buildDiffFromToolArgs(toolName: string, rawArgs: any, rawResult?: any): string | null {
  const name = (toolName || '').toLowerCase();
  const normName = name.replace(/[-_]/g, '');

  let args = rawArgs;
  if (typeof args === 'string') {
    try { args = JSON.parse(args); } catch {}
  }

  // 1. Try extracting diff from rawResult if present (e.g. agy tool output containing [diff_block_start]...[diff_block_end])
  if (rawResult && typeof rawResult === 'string') {
    const diffBlockMatch = rawResult.match(/\[diff_block_start\]([\s\S]*?)\[diff_block_end\]/);
    if (diffBlockMatch && diffBlockMatch[1].trim()) {
      return diffBlockMatch[1].trim();
    }
  }

  // 2. Build diff from args if present
  if (typeof args === 'object' && args) {
    const file = args.TargetFile || args.targetFile || args.target_file || args.path || args.file || '';
    const fileName = file ? String(file).replace(/^"|"$/g, '').split(/[\/\\]/).pop() : 'file';

    let diffLines: string[] = [];

    if (normName.includes('replacefilecontent') && !normName.includes('multi')) {
      const target = args.TargetContent || args.targetContent || args.target_content || '';
      const replacement = args.ReplacementContent || args.replacementContent || args.replacement_content || '';
      if (target || replacement) {
        diffLines.push(`--- a/${fileName}`);
        diffLines.push(`+++ b/${fileName}`);
        diffLines.push(`@@ edit @@`);
        if (target) {
          String(target).split('\n').forEach((l: string) => diffLines.push(`-${l}`));
        }
        if (replacement) {
          String(replacement).split('\n').forEach((l: string) => diffLines.push(`+${l}`));
        }
      }
    } else if (normName.includes('multireplacefilecontent')) {
      const chunks = args.ReplacementChunks || args.replacementChunks || args.replacement_chunks || args.chunks || [];
      if (Array.isArray(chunks) && chunks.length > 0) {
        diffLines.push(`--- a/${fileName}`);
        diffLines.push(`+++ b/${fileName}`);
        chunks.forEach((chunk: any, idx: number) => {
          diffLines.push(`@@ chunk ${idx + 1} @@`);
          const target = chunk.TargetContent || chunk.targetContent || chunk.target_content || '';
          const replacement = chunk.ReplacementContent || chunk.replacementContent || chunk.replacement_content || '';
          if (target) {
            String(target).split('\n').forEach((l: string) => diffLines.push(`-${l}`));
          }
          if (replacement) {
            String(replacement).split('\n').forEach((l: string) => diffLines.push(`+${l}`));
          }
        });
      }
    } else if (normName.includes('writetofile') || normName.includes('writefile')) {
      const code = args.CodeContent || args.codeContent || args.code_content || args.code || '';
      if (code) {
        diffLines.push(`--- /dev/null`);
        diffLines.push(`+++ b/${fileName}`);
        diffLines.push(`@@ new file @@`);
        String(code).split('\n').forEach((l: string) => diffLines.push(`+${l}`));
      }
    }

    if (diffLines.length > 0) {
      return diffLines.join('\n');
    }
  }

  // 3. Fallback to rawResult diff if it contains unified diff format
  if (rawResult && typeof rawResult === 'string' && isDiffText(rawResult)) {
    return rawResult.trim();
  }

  return null;
}

function renderDiffOrTextHtml(text: string): string {
  if (!isDiffText(text)) {
    return esc(text);
  }

  const lines = text.split('\n');
  return lines.map(line => {
    const escaped = esc(line);
    if (line.startsWith('diff --git') || line.startsWith('index ') || line.startsWith('--- ') || line.startsWith('+++ ')) {
      return `<span class="diff-header">${escaped}</span>`;
    } else if (/^@@ -\d+(,\d+)? \+\d+(,\d+)? @@/.test(line) || line.startsWith('@@ ')) {
      return `<span class="diff-info">${escaped}</span>`;
    } else if (line.startsWith('+') && !line.startsWith('+++')) {
      return `<span class="diff-add">${escaped}</span>`;
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      return `<span class="diff-del">${escaped}</span>`;
    }
    return escaped;
  }).join('\n');
}

function applyDiffHighlighting(container: HTMLElement) {
  const codeBlocks = container.querySelectorAll('pre code');
  codeBlocks.forEach((block) => {
    const text = block.textContent || '';
    if (block.classList.contains('language-diff') || isDiffText(text)) {
      block.innerHTML = renderDiffOrTextHtml(text);
    }
  });
}

function renderPermissionPromptCard(promptText?: string) {
  const log = document.getElementById('chat-messages');
  if (!log) return;

  const card = document.createElement('div');
  card.className = 'msg msg-permission-request';

  card.innerHTML = `
    <div class="permission-card">
      <div class="permission-header">
        <span class="permission-icon">&#128737;</span>
        <span class="permission-title">Permission Required</span>
      </div>
      <div class="permission-body">
        ${promptText ? esc(promptText) : 'Antigravity needs permission to run CLI tools and perform operations on your system. Select how to proceed:'}
      </div>
      <div class="permission-actions">
        <button class="perm-btn perm-btn-primary" data-action="yes">Yes (this command only)</button>
        <button class="perm-btn perm-btn-secondary" data-action="session">Yes for all commands in this session</button>
        <button class="perm-btn perm-btn-cancel" data-action="no">No</button>
      </div>
    </div>
  `;

  const buttons = card.querySelectorAll<HTMLButtonElement>('.perm-btn');
  buttons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const action = btn.getAttribute('data-action') as 'yes' | 'session' | 'settings' | 'no';
      
      buttons.forEach(b => {
        b.disabled = true;
        b.style.opacity = '0.5';
      });
      btn.style.opacity = '1';
      btn.style.fontWeight = 'bold';

      const body = card.querySelector('.permission-body');
      if (action === 'no') {
        if (body) body.textContent = 'Permission denied. Task cancelled.';
        setBusy(false);
      } else {
        if (body) body.textContent = `Permission granted (${btn.textContent}). Running prompt...`;
        setBusy(true);
      }

      vscode.postMessage({
        command: 'permissionResponse',
        choice: action,
      });
    });
  });

  log.appendChild(card);
  log.scrollTop = log.scrollHeight;
}

window.addEventListener('message', (event) => {
  const data = event.data;

  switch (data.type) {
    case 'focusInput':
      input?.focus();
      break;
    case 'permissionRequest':
      setBusy(false);
      renderPermissionPromptCard(data.promptText);
      break;
    case 'textDelta':
      if (currentStreamingMessage) {
        currentStreamingMessage.text += data.delta;
        renderAll();
      }
      break;

    case 'thinkingDelta':
      if (currentStreamingMessage) {
        currentStreamingMessage.thinking = (currentStreamingMessage.thinking || '') + data.delta;
        renderAll();
      }
      break;

    case 'toolCall':
      if (currentStreamingMessage) {
        if (!currentStreamingMessage.toolCalls) currentStreamingMessage.toolCalls = [];
        
        const rawName = (data.name || '').toLowerCase();
        const isGenericName = !rawName || ['tool', 'tool_call', 'tool_use', 'tool execution', 'tool_execution'].includes(rawName);
        
        if (isGenericName && !data.args && !data.result && !data.id) {
          break;
        }

        let existing = data.id !== undefined && data.id !== null
          ? currentStreamingMessage.toolCalls.find(tc => tc.id === data.id)
          : null;

        if (!existing && data.name && !isGenericName) {
          existing = currentStreamingMessage.toolCalls.find(
            tc => tc.name.toLowerCase() === data.name.toLowerCase() && (tc.status === 'running' || !tc.result || !tc.args)
          ) || null;
        }

        if (existing) {
          if (data.id) existing.id = data.id;
          if (data.name && !isGenericName) existing.name = data.name;
          if (data.args && (typeof data.args === 'string' || (typeof data.args === 'object' && Object.keys(data.args).length > 0))) {
            if (typeof existing.args === 'object' && typeof data.args === 'object') {
              existing.args = { ...existing.args, ...data.args };
            } else {
              existing.args = data.args;
            }
          }
          if (data.status) existing.status = data.status;
          if (data.result !== undefined && data.result !== null && String(data.result).trim() !== '') {
            existing.result = data.result;
            if (typeof data.result === 'string' && (data.result.includes('[Permission Required]') || data.result.includes('User denied permission') || data.result.includes('blocked by safety policy'))) {
              existing.expanded = true;
            }
          }
          if (data.status === 'error') {
            existing.expanded = true;
          }
        } else {
          const isPermError = typeof data.result === 'string' && (data.result.includes('[Permission Required]') || data.result.includes('User denied permission') || data.result.includes('blocked by safety policy'));
          currentStreamingMessage.toolCalls.push({
            id: data.id,
            name: (data.name && !isGenericName) ? data.name : 'Tool Execution',
            args: data.args,
            status: data.status || 'done',
            result: data.result,
            expanded: isPermError || data.status === 'error',
          });
        }
        renderAll();
      }
      break;

    case 'stepComplete':
      if (currentStreamingMessage && data.usage) {
        currentStreamingMessage.tokens = data.usage;
        renderAll();
      }
      break;

    case 'result':
      setBusy(false);
      if (currentStreamingMessage) {
        if (!currentStreamingMessage.text && data.response && data.response.trim().length > 0) {
          currentStreamingMessage.text = data.response;
        }
        if (
          !currentStreamingMessage.text &&
          (!currentStreamingMessage.thinking || !currentStreamingMessage.thinking.trim()) &&
          (!currentStreamingMessage.toolCalls || currentStreamingMessage.toolCalls.length === 0)
        ) {
          if (data.status === 'ERROR' || data.status === 'FAILURE') {
            currentStreamingMessage.text = '[Response failed]';
          }
        }
        if (data.usage) {
          currentStreamingMessage.tokens = data.usage;
        }
        currentStreamingMessage.isStreaming = false;
      }
      currentStreamingMessage = null;
      renderAll();
      break;

    case 'error':
      setBusy(false);
      if (currentStreamingMessage) {
        currentStreamingMessage.text = currentStreamingMessage.text
          ? `${currentStreamingMessage.text}\n[error: ${data.error}]`
          : `[error: ${data.error}]`;
        currentStreamingMessage.isStreaming = false;
      }
      currentStreamingMessage = null;
      renderAll();
      break;

    case 'fileSearchResults': {
      const match = getAtMatch();
      if (match) {
        atFilteredFiles = data.files || [];
        atMenuIndex = 0;
        renderAtMenu();
      } else {
        hideAtMenu();
      }
      break;
    }

    case 'activeFile':
      if (fileChip && contextBar) {
        if (data.filePath) {
          fileChip.textContent = `@ ${data.filePath}`;
          contextBar.style.display = 'block';
        } else {
          contextBar.style.display = 'none';
        }
      }
      break;

    case 'cancelled':
    case 'processExit':
      setBusy(false);
      if (currentStreamingMessage) {
        currentStreamingMessage.isStreaming = false;
        if (data.type === 'cancelled' && !currentStreamingMessage.text) {
          currentStreamingMessage.text = '[cancelled]';
        }
      }
      currentStreamingMessage = null;
      renderAll();
      break;

    case 'setSlashCommands':
      if (data.commands && Array.isArray(data.commands)) {
        SLASH_COMMANDS = data.commands;
      }
      break;

    case 'slashResult':
      if (data.message) {
        messages.push({
          id: `sys-${Date.now()}`,
          role: 'assistant',
          text: data.message,
        });
        renderAll();
      }
      break;

    case 'imagesAttached':
      if (data.paths && Array.isArray(data.paths)) {
        attachedImages.push(...data.paths);
        renderImageBar();
      }
      break;

    case 'sessionsList':
      renderHistoryDropdown(data.sessions, data.currentId);
      break;

    case 'sessionLoaded': {
      activeConversationId = data.conversationId;
      messages = [];
      currentStreamingMessage = null;

      if (headerSessionTitle) {
        headerSessionTitle.textContent = data.title || (data.conversationId ? `Session ${data.conversationId.substring(0, 8)}` : 'Untitled');
      }

      if (data.events && Array.isArray(data.events)) {
        let currentAssistantMsg: Message | null = null;
        for (const evt of data.events) {
          if (evt.type === 'userMessage') {
            currentAssistantMsg = null;
            messages.push({
              id: `msg-${Date.now()}-${Math.random()}`,
              role: 'user',
              text: evt.text
            });
          } else if (evt.type === 'assistantText') {
            if (!currentAssistantMsg) {
              currentAssistantMsg = {
                id: `msg-${Date.now()}-${Math.random()}`,
                role: 'assistant',
                text: evt.text
              };
              messages.push(currentAssistantMsg);
            } else {
              currentAssistantMsg.text = (currentAssistantMsg.text ? currentAssistantMsg.text + '\n' : '') + evt.text;
            }
          } else if (evt.type === 'toolCall') {
            if (!currentAssistantMsg) {
              currentAssistantMsg = {
                id: `msg-${Date.now()}-${Math.random()}`,
                role: 'assistant',
                text: '',
                toolCalls: []
              };
              messages.push(currentAssistantMsg);
            }
            if (!currentAssistantMsg.toolCalls) {
              currentAssistantMsg.toolCalls = [];
            }
            currentAssistantMsg.toolCalls.push({
              id: `tc-${Date.now()}-${Math.random()}`,
              name: evt.name,
              args: evt.args,
              result: evt.result,
              status: evt.status || 'done'
            });
          }
        }
      }

      renderAll(true);
      break;
    }

    case 'updateTitle':
      if (headerSessionTitle && data.title) {
        headerSessionTitle.textContent = data.title;
      }
      break;
  }
});

vscode.postMessage({ command: 'getActiveFile' });
vscode.postMessage({ command: 'getSlashCommands' });
vscode.postMessage({ command: 'getSessions' });

let activeConversationId: string | null = null;

const headerSessionTitle = document.getElementById('header-session-title') as HTMLElement;
const editHeaderTitleBtn = document.getElementById('edit-header-title-btn') as HTMLButtonElement;

if (headerSessionTitle && editHeaderTitleBtn) {
  const triggerHeaderRename = () => {
    const currentTitle = headerSessionTitle.textContent || 'Untitled';
    const inputEl = document.createElement('input');
    inputEl.type = 'text';
    inputEl.className = 'header-title-rename-input';
    inputEl.value = currentTitle;
    headerSessionTitle.replaceWith(inputEl);
    inputEl.focus();
    inputEl.select();

    const saveHeaderTitle = () => {
      const newTitle = inputEl.value.trim();
      if (newTitle && activeConversationId) {
        vscode.postMessage({ command: 'renameSession', conversationId: activeConversationId, title: newTitle });
      }
      inputEl.replaceWith(headerSessionTitle);
      if (newTitle) headerSessionTitle.textContent = newTitle;
    };

    inputEl.addEventListener('blur', saveHeaderTitle);
    inputEl.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        inputEl.blur();
      } else if (ev.key === 'Escape') {
        ev.preventDefault();
        inputEl.replaceWith(headerSessionTitle);
      }
    });
  };

  editHeaderTitleBtn.addEventListener('click', triggerHeaderRename);
  headerSessionTitle.addEventListener('dblclick', triggerHeaderRename);
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

let cachedSessionsList: Array<{ id: string; title: string; updatedAt: number; relativeTime: string }> = [];

function renderHistoryDropdown(sessions: Array<{ id: string; title: string; updatedAt: number; relativeTime: string }>, currentId?: string | null) {
  if (!historyDropdown) return;
  cachedSessionsList = sessions || [];
  renderFilteredSessions(cachedSessionsList, currentId, '');
}

function renderFilteredSessions(sessions: Array<{ id: string; title: string; updatedAt: number; relativeTime: string }>, currentId?: string | null, searchQuery = '') {
  if (!historyDropdown) return;

  const query = searchQuery.trim().toLowerCase();
  const filtered = query
    ? sessions.filter(s => s.title.toLowerCase().includes(query) || s.id.toLowerCase().includes(query))
    : sessions;

  let html = `
    <div class="history-header">
      <span>Session History</span>
      <span style="font-size: 9px; font-weight: normal; text-transform: none;">${filtered.length} sessions</span>
    </div>
    <div class="history-search-container">
      <input type="text" id="history-search-input" placeholder="Search sessions..." value="${escapeHtml(searchQuery)}" autocomplete="off" />
    </div>
    <div class="history-items-list">
  `;

  if (filtered.length === 0) {
    html += `
      <div style="padding: 12px; font-size: 11px; color: var(--text-secondary); text-align: center;">
        No matching sessions found.
      </div>
    `;
  } else {
    for (const s of filtered) {
      const isActive = currentId && currentId === s.id;
      html += `
        <div class="history-item ${isActive ? 'active' : ''}" data-id="${s.id}">
          <div class="history-item-content">
            <div class="history-item-title" title="${escapeHtml(s.title)}">${escapeHtml(s.title)}</div>
            <div class="history-item-meta">
              <span class="history-item-id">${s.id.substring(0, 8)}</span>
              <span class="history-item-time">${s.relativeTime}</span>
            </div>
          </div>
          <button class="history-item-edit-btn icon-btn" title="Rename session" data-id="${s.id}">&#9999;&#65039;</button>
        </div>
      `;
    }
  }

  html += `</div>`;
  historyDropdown.innerHTML = html;

  const searchInput = historyDropdown.querySelector('#history-search-input') as HTMLInputElement;
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      renderFilteredSessions(cachedSessionsList, currentId, (e.target as HTMLInputElement).value);
    });
    if (searchQuery) {
      searchInput.focus();
      searchInput.setSelectionRange(searchQuery.length, searchQuery.length);
    }
  }

  const items = historyDropdown.querySelectorAll('.history-item');
  items.forEach((item) => {
    item.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('.history-item-edit-btn')) {
        return;
      }
      const convId = item.getAttribute('data-id');
      if (convId) {
        historyDropdown.style.display = 'none';
        vscode.postMessage({ command: 'selectSession', conversationId: convId });
      }
    });
  });

  const editBtns = historyDropdown.querySelectorAll('.history-item-edit-btn');
  editBtns.forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const convId = btn.getAttribute('data-id');
      if (!convId) return;
      const targetSession = cachedSessionsList.find(s => s.id === convId);
      const currentTitle = targetSession ? targetSession.title : '';
      const itemEl = btn.closest('.history-item');
      if (!itemEl) return;
      const titleEl = itemEl.querySelector('.history-item-title') as HTMLElement;
      if (!titleEl) return;

      const inputEl = document.createElement('input');
      inputEl.type = 'text';
      inputEl.className = 'history-item-rename-input';
      inputEl.value = currentTitle;
      titleEl.replaceWith(inputEl);
      inputEl.focus();
      inputEl.select();

      const save = () => {
        const newTitle = inputEl.value.trim();
        if (newTitle && newTitle !== currentTitle) {
          vscode.postMessage({ command: 'renameSession', conversationId: convId, title: newTitle });
        } else {
          inputEl.replaceWith(titleEl);
        }
      };

      inputEl.addEventListener('blur', save);
      inputEl.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') {
          ev.preventDefault();
          inputEl.blur();
        } else if (ev.key === 'Escape') {
          ev.preventDefault();
          inputEl.replaceWith(titleEl);
        }
      });
    });
  });
}

if (messages.length > 0) {
  renderAll();
}
