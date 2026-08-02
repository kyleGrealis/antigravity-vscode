import { marked } from 'marked';

marked.setOptions({ breaks: true, gfm: true });

declare function acquireVsCodeApi(): any;
const vscode = acquireVsCodeApi();

interface ToolCall {
  name: string;
  args?: Record<string, any>;
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

interface SlashCommand {
  name: string;
  description: string;
  hasArg?: boolean;
  argHint?: string;
}

const SLASH_COMMANDS: SlashCommand[] = [
  { name: 'new', description: 'start a new conversation' },
  { name: 'clear', description: 'clear chat history' },
  { name: 'model', description: 'set the model', hasArg: true, argHint: '<model-name>' },
  { name: 'effort', description: 'set reasoning effort', hasArg: true, argHint: 'low | medium | high' },
  { name: 'terminal', description: 'open agy in terminal mode' },
  { name: 'settings', description: 'open extension settings' },
  { name: 'help', description: 'show available commands' },
];

const savedState = vscode.getState() as { messages?: Message[] } | undefined;
let messages: Message[] = savedState?.messages || [];
let currentStreamingMessage: Message | null = null;
let slashMenuIndex = 0;
let slashFiltered: SlashCommand[] = [];

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
});

input?.addEventListener('keydown', (e) => {
  if (isSlashMenuVisible()) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      slashMenuIndex = Math.min(slashMenuIndex + 1, slashFiltered.length - 1);
      renderSlashMenu();
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      slashMenuIndex = Math.max(slashMenuIndex - 1, 0);
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
  return slashMenu?.style.display !== 'none';
}

function updateSlashMenu() {
  const match = getSlashMatch();
  if (!match) {
    hideSlashMenu();
    return;
  }
  const q = match.query.toLowerCase();
  slashFiltered = SLASH_COMMANDS.filter(c => c.name.startsWith(q));
  if (slashFiltered.length === 0) {
    hideSlashMenu();
    return;
  }
  slashMenuIndex = 0;
  renderSlashMenu();
  slashMenu.style.display = 'block';
}

function renderSlashMenu() {
  if (!slashMenu) return;
  slashMenu.innerHTML = '';
  slashFiltered.forEach((cmd, i) => {
    const row = document.createElement('div');
    row.className = 'slash-item' + (i === slashMenuIndex ? ' active' : '');
    row.innerHTML = `<span class="slash-name">/${esc(cmd.name)}</span><span class="slash-desc">${esc(cmd.description)}</span>`;
    row.addEventListener('mousedown', (e) => {
      e.preventDefault();
      slashMenuIndex = i;
      acceptSlashItem();
    });
    slashMenu.appendChild(row);
  });
}

function acceptSlashItem() {
  const cmd = slashFiltered[slashMenuIndex];
  if (!cmd) return;
  if (cmd.hasArg) {
    input.value = `/${cmd.name} `;
    hideSlashMenu();
    input.focus();
  } else {
    input.value = '';
    hideSlashMenu();
    executeSlashCommand(cmd.name);
  }
}

function hideSlashMenu() {
  if (slashMenu) slashMenu.style.display = 'none';
  slashFiltered = [];
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

  renderAll();
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

function formatToolArgs(tc: ToolCall): { text: string; isFile: boolean } {
  if (!tc.args) return { text: '', isFile: false };
  const file = tc.args.TargetFile || tc.args.targetFile || tc.args.file_path || tc.args.path || '';
  if (file) return { text: file, isFile: true };
  const keys = Object.keys(tc.args);
  if (keys.length === 0) return { text: '', isFile: false };
  return { text: keys.slice(0, 2).map(k => `${k}: ${String(tc.args![k]).slice(0, 40)}`).join(', '), isFile: false };
}

function renderAll() {
  if (!log) return;
  log.innerHTML = '';

  for (const msg of messages) {
    const el = document.createElement('div');
    el.className = 'msg';

    const role = document.createElement('div');
    role.className = `msg-role ${msg.role}`;
    role.textContent = msg.role === 'user' ? 'you' : 'antigravity';
    el.appendChild(role);

    if (msg.role === 'assistant' && msg.thinking && msg.thinking.trim()) {
      el.appendChild(renderThinking(msg.thinking));
    }

    if (msg.toolCalls && msg.toolCalls.length > 0) {
      const toolSection = document.createElement('div');
      toolSection.className = 'tool-section';
      for (const tc of msg.toolCalls) {
        const item = document.createElement('div');
        item.className = 'tool-item';
        item.innerHTML = `<span class="tool-icon">></span><span class="tool-name">${esc(tc.name)}</span>`;
        const detail = formatToolArgs(tc);
        if (detail.text) {
          if (detail.isFile) {
            item.innerHTML += `<span class="tool-detail clickable-file" data-path="${esc(detail.text)}" title="Click to open in editor">${esc(detail.text)}</span>`;
          } else {
            item.innerHTML += `<span class="tool-detail">${esc(detail.text)}</span>`;
          }
        }
        toolSection.appendChild(item);
      }
      el.appendChild(toolSection);
    }

    const body = document.createElement('div');
    body.className = 'msg-body';
    if (msg.role === 'assistant' && msg.text) {
      body.innerHTML = marked.parse(msg.text) as string;
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

  log.scrollTop = log.scrollHeight;

  const toSave = messages.filter(m => !m.isStreaming);
  vscode.setState({ messages: toSave });
}

function renderThinking(text: string): HTMLElement {
  const section = document.createElement('div');
  section.className = 'thinking-section';

  const toggle = document.createElement('button');
  toggle.className = 'thinking-toggle';
  const lines = text.split('\n').length;
  toggle.innerHTML = `<span class="thinking-chevron">&#9656;</span> thinking (${lines} lines)`;

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
        currentStreamingMessage.toolCalls.push({ name: data.name, args: data.args });
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
        currentStreamingMessage.text += `\n[error: ${data.error}]`;
        currentStreamingMessage.isStreaming = false;
      }
      currentStreamingMessage = null;
      renderAll();
      break;

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
