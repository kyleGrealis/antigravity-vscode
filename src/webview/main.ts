import { marked } from 'marked';

marked.setOptions({ breaks: true, gfm: true });

declare function acquireVsCodeApi(): any;
const vscode = acquireVsCodeApi();

interface ToolCall {
  id?: string | number;
  name: string;
  args?: Record<string, any>;
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
  options?: SlashOption[];
}

interface SlashDisplayItem {
  name: string;
  displayName: string;
  description: string;
  hasArg?: boolean;
  insertValue?: string;
}

const SLASH_COMMANDS: SlashCommand[] = [
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
  { name: 'terminal', description: 'open agy in terminal mode' },
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
const sendBtn = document.getElementById('send-btn') as HTMLButtonElement;
const cancelBtn = document.getElementById('cancel-btn') as HTMLButtonElement;
const newChatBtn = document.getElementById('new-chat-btn') as HTMLButtonElement;
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
    row.innerHTML = `<span class="slash-name">${esc(cmd.displayName)}</span><span class="slash-desc">${esc(cmd.description)}</span>`;
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
    statusEl.textContent = busy ? 'thinking...' : '';
    statusEl.className = busy ? 'status-indicator active' : 'status-indicator';
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

function renderAll(autoScrollForce: boolean = false) {
  if (!log) return;
  const wasAtBottom = (log.scrollHeight - log.scrollTop - log.clientHeight) <= 80;
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
        accordion.className = 'tool-accordion';

        const header = document.createElement('div');
        header.className = 'tool-header';

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

        const diffStr = buildDiffFromToolArgs(tc.name, tc.args);
        if (diffStr) {
          hasContent = true;
          const diffBlock = document.createElement('div');
          diffBlock.className = 'tool-diff-block';
          const title = document.createElement('div');
          title.className = 'tool-block-title';
          title.textContent = 'Changes (Diff)';
          diffBlock.appendChild(title);

          const pre = document.createElement('pre');
          pre.className = 'tool-json-pre';
          pre.innerHTML = renderDiffOrTextHtml(diffStr);
          diffBlock.appendChild(pre);
          bodyInner.appendChild(diffBlock);
        }

        if (tc.args && (typeof tc.args === 'string' || Object.keys(tc.args).length > 0)) {
          hasContent = true;
          const argsBlock = document.createElement('div');
          argsBlock.className = 'tool-args-block';
          const title = document.createElement('div');
          title.className = 'tool-block-title';
          title.textContent = 'Arguments';
          argsBlock.appendChild(title);

          const pre = document.createElement('pre');
          pre.className = 'tool-json-pre';
          let formattedArgs = tc.args;
          if (typeof formattedArgs === 'string') {
            try {
              const parsed = JSON.parse(formattedArgs);
              formattedArgs = JSON.stringify(parsed, null, 2);
            } catch {}
          } else {
            formattedArgs = JSON.stringify(formattedArgs, null, 2);
          }
          pre.textContent = formattedArgs;
          argsBlock.appendChild(pre);
          bodyInner.appendChild(argsBlock);
        }

        if (tc.result !== undefined && tc.result !== null && String(tc.result).trim() !== '') {
          hasContent = true;
          const resultBlock = document.createElement('div');
          resultBlock.className = 'tool-result-block';
          const title = document.createElement('div');
          title.className = 'tool-block-title';
          title.textContent = 'Output';
          resultBlock.appendChild(title);

          const pre = document.createElement('pre');
          pre.className = 'tool-json-pre';
          let formattedResult = tc.result;
          if (typeof formattedResult === 'string') {
            try {
              const parsed = JSON.parse(formattedResult);
              formattedResult = JSON.stringify(parsed, null, 2);
            } catch {}
          } else {
            formattedResult = JSON.stringify(formattedResult, null, 2);
          }
          if (typeof formattedResult === 'string') {
            pre.innerHTML = renderDiffOrTextHtml(formattedResult);
          } else {
            pre.textContent = String(formattedResult);
          }
          resultBlock.appendChild(pre);
          bodyInner.appendChild(resultBlock);
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
        });

        accordion.appendChild(header);
        accordion.appendChild(body);
        toolSection.appendChild(accordion);
      }
      el.appendChild(toolSection);
      requestAnimationFrame(() => {
        if (autoScrollForce || wasAtBottom) {
          toolSection.scrollTop = toolSection.scrollHeight;
        }
      });
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

  requestAnimationFrame(() => {
    if (autoScrollForce || wasAtBottom) {
      log.scrollTop = log.scrollHeight;
    }
  });

  const toSave = messages.filter(m => !m.isStreaming);
  vscode.setState({ messages: toSave });
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
  const lines = text.split('\n');
  let hasAdd = false;
  let hasDel = false;
  let hasHdr = false;

  for (const line of lines) {
    if (line.startsWith('diff --git') || line.startsWith('index ') || (line.startsWith('--- ') && lines.some(l => l.startsWith('+++ ')))) {
      hasHdr = true;
    }
    if (/^@@ -\d+(,\d+)? \+\d+(,\d+)? @@/.test(line)) {
      hasHdr = true;
    }
    if (line.startsWith('+') && !line.startsWith('+++')) {
      hasAdd = true;
    }
    if (line.startsWith('-') && !line.startsWith('---')) {
      hasDel = true;
    }
  }

  return hasHdr || (hasAdd && hasDel) || (hasAdd && lines.length <= 15) || (hasDel && lines.length <= 15);
}

function buildDiffFromToolArgs(toolName: string, rawArgs: any): string | null {
  if (!rawArgs) return null;
  let args = rawArgs;
  if (typeof args === 'string') {
    try { args = JSON.parse(args); } catch {}
  }
  if (typeof args !== 'object' || !args) return null;

  const name = toolName.toLowerCase();
  const file = args.TargetFile || args.targetFile || args.path || args.file || '';
  const fileName = file ? file.split(/[\/\\]/).pop() : 'file';

  let diffLines: string[] = [];

  if (name.includes('replace_file_content') && !name.includes('multi')) {
    const target = args.TargetContent || '';
    const replacement = args.ReplacementContent || '';
    if (target || replacement) {
      diffLines.push(`--- a/${fileName}`);
      diffLines.push(`+++ b/${fileName}`);
      diffLines.push(`@@ edit @@`);
      if (target) {
        target.split('\n').forEach((l: string) => diffLines.push(`-${l}`));
      }
      if (replacement) {
        replacement.split('\n').forEach((l: string) => diffLines.push(`+${l}`));
      }
    }
  } else if (name.includes('multi_replace_file_content')) {
    const chunks = args.ReplacementChunks || args.chunks || [];
    if (Array.isArray(chunks) && chunks.length > 0) {
      diffLines.push(`--- a/${fileName}`);
      diffLines.push(`+++ b/${fileName}`);
      chunks.forEach((chunk: any, idx: number) => {
        diffLines.push(`@@ chunk ${idx + 1} @@`);
        const target = chunk.TargetContent || '';
        const replacement = chunk.ReplacementContent || '';
        if (target) {
          target.split('\n').forEach((l: string) => diffLines.push(`-${l}`));
        }
        if (replacement) {
          replacement.split('\n').forEach((l: string) => diffLines.push(`+${l}`));
        }
      });
    }
  } else if (name.includes('write_to_file')) {
    const code = args.CodeContent || args.code || '';
    if (code) {
      diffLines.push(`--- /dev/null`);
      diffLines.push(`+++ b/${fileName}`);
      diffLines.push(`@@ new file @@`);
      code.split('\n').forEach((l: string) => diffLines.push(`+${l}`));
    }
  }

  return diffLines.length > 0 ? diffLines.join('\n') : null;
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

window.addEventListener('message', (event) => {
  const data = event.data;

  switch (data.type) {
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
          }
        } else {
          currentStreamingMessage.toolCalls.push({
            id: data.id,
            name: (data.name && !isGenericName) ? data.name : 'Tool Execution',
            args: data.args,
            status: data.status || 'done',
            result: data.result,
            expanded: false,
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
  }
});

vscode.postMessage({ command: 'getActiveFile' });

if (messages.length > 0) {
  renderAll();
}
