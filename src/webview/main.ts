import { marked } from 'marked';
import mermaid from 'mermaid';
import { ToolCall, Message, SlashCommand, SlashDisplayItem, SlashOption } from './types';
import { esc, cleanValue } from './utils/escape';
import { toPascalCaseName, getArgVal, parseJsonArgs, extractJsonStringField, formatToolSummary, formatToolArgsForDisplay } from './utils/formatters';
import { extractStringResult, extractTargetFile, isDiffText, isFileEditTool, buildDiffFromToolArgs, renderDiffOrTextHtml } from './utils/diffBuilder';
import { renderToolCallCard } from './components/toolCard';

marked.setOptions({ breaks: true, gfm: true });

declare function acquireVsCodeApi(): any;
const vscode = acquireVsCodeApi();



let SLASH_COMMANDS: SlashCommand[] = [
  { name: 'sandbox', description: 'toggle sandboxing (on|off)', hasArg: true },
  { name: 'dangerous', description: 'toggle permission auto-approvals (on|off)', hasArg: true },
  { name: 'plan', description: 'trigger plan mode with optional description', hasArg: true },
  { name: 'usage', description: 'show session token usage statistics overlay' },
  { name: 'new', description: 'start a new conversation' },
  { name: 'clear', description: 'clear chat history' },
  { name: 'settings', description: 'open extension settings' },
  { name: 'help', description: 'show available commands' },
];

const savedState = vscode.getState() as { messages?: Message[] } | undefined;
let messages: Message[] = savedState?.messages || [];
let currentStreamingMessage: Message | null = null;
let activeConversationId: string | null = null;
let slashMenuIndex = 0;
let slashFiltered: SlashDisplayItem[] = [];

let attachedImages: string[] = [];

const log = document.getElementById('chat-messages') as HTMLElement;
let isRendering = false;
let isUserScrolledUp = false;
let dirtyWhileScrolledUp = false;
let scrollToBottomPillEl: HTMLElement | null = null;

function getScrollToBottomPill(): HTMLElement {
  if (!scrollToBottomPillEl) {
    scrollToBottomPillEl = document.createElement('div');
    scrollToBottomPillEl.className = 'scroll-to-bottom-pill';
    scrollToBottomPillEl.innerHTML = `<span class="scroll-to-bottom-pill-arrow">↓</span><span>New activity below</span>`;
    scrollToBottomPillEl.onclick = () => {
      isUserScrolledUp = false;
      dirtyWhileScrolledUp = false;
      hideScrollToBottomPill();
      renderAll(true);
    };
    document.body.appendChild(scrollToBottomPillEl);
  }
  return scrollToBottomPillEl;
}

function showScrollToBottomPill() {
  const pill = getScrollToBottomPill();
  pill.classList.add('visible');
}

function hideScrollToBottomPill() {
  if (scrollToBottomPillEl) {
    scrollToBottomPillEl.classList.remove('visible');
  }
}

if (log) {
  const markUserScrolled = () => {
    if (isRendering) return;
    const distanceFromBottom = log.scrollHeight - log.scrollTop - log.clientHeight;
    if (distanceFromBottom > 60) {
      isUserScrolledUp = true;
    } else {
      const wasScrolledUp = isUserScrolledUp;
      isUserScrolledUp = false;
      hideScrollToBottomPill();
      if (wasScrolledUp && dirtyWhileScrolledUp) {
        dirtyWhileScrolledUp = false;
        renderAll(true);
      }
    }
  };

  log.addEventListener('wheel', markUserScrolled, { passive: true });
  log.addEventListener('touchmove', markUserScrolled, { passive: true });
  log.addEventListener('scroll', markUserScrolled, { passive: true });
}

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

let promptHistory: string[] = [];
try {
  const saved = localStorage.getItem('antigravity_prompt_history');
  if (saved) {
    promptHistory = JSON.parse(saved);
  }
} catch (e) {}
let historyIndex: number = promptHistory.length;
let currentDraft: string = '';

let atMenuIndex = 0;
let atFilteredFiles: string[] = [];
let atDebounceTimer: any = null;

let activeMode: 'default' | 'plan' | 'auto' = 'default';

function setExecutionMode(mode: 'default' | 'plan' | 'auto') {
  activeMode = mode;
  const modeTextEl = document.getElementById('mode-text');
  if (!modeTextEl) return;

  if (mode === 'plan') {
    modeTextEl.textContent = 'plan';
    modeTextEl.className = 'mode-text mode-plan';
    modeTextEl.style.display = 'inline-block';
  } else if (mode === 'auto') {
    modeTextEl.textContent = 'auto accept';
    modeTextEl.className = 'mode-text mode-auto';
    modeTextEl.style.display = 'inline-block';
  } else {
    modeTextEl.textContent = '';
    modeTextEl.className = 'mode-text';
    modeTextEl.style.display = 'none';
  }
}

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

function adjustInputHeight() {
  if (input) {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 200) + 'px';
  }
}

input?.addEventListener('input', () => {
  adjustInputHeight();
  updateSlashMenu();
  updateAtMenu();
});

input?.addEventListener('keydown', (e) => {
  if (e.key === '`') {
    const start = input.selectionStart;
    const val = input.value;
    if (start >= 2 && val.slice(start - 2, start) === '``') {
      e.preventDefault();
      const before = val.slice(0, start - 2);
      const after = val.slice(start);
      const prefix = (before && !before.endsWith('\n')) ? '\n```' : '```';
      const suffix = (after && !after.startsWith('\n')) ? '\n```' : '```';
      input.value = `${before}${prefix}\n\n${suffix}${after}`;
      const cursorPos = (before + prefix + '\n').length;
      input.selectionStart = input.selectionEnd = cursorPos;
      adjustInputHeight();
      return;
    }
  }

  if (e.key === 'Tab' && e.shiftKey) {
    e.preventDefault();
    if (activeMode === 'default') {
      setExecutionMode('plan');
    } else if (activeMode === 'plan') {
      setExecutionMode('auto');
    } else {
      setExecutionMode('default');
    }
    return;
  }

  if (e.key === 'Escape') {
    const usageOverlay = document.getElementById('usage-overlay');
    if (usageOverlay) {
      usageOverlay.remove();
      return;
    }
    if (isAtMenuVisible()) {
      hideAtMenu();
      return;
    }
    if (isSlashMenuVisible()) {
      hideSlashMenu();
      return;
    }
    if (isBusyState) {
      e.preventDefault();
      vscode.postMessage({ command: 'cancel' });
      return;
    }
  }

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

  if (e.key === 'ArrowUp') {
    if (!isAtMenuVisible() && !isSlashMenuVisible() && promptHistory.length > 0) {
      const isCursorAtStart = input.selectionStart === 0 && input.selectionEnd === 0;
      if (input.value.trim() === '' || isCursorAtStart) {
        if (historyIndex === -1 || historyIndex === promptHistory.length) {
          currentDraft = input.value;
        }
        if (historyIndex > 0) {
          historyIndex--;
          input.value = promptHistory[historyIndex];
          e.preventDefault();
          const len = input.value.length;
          input.setSelectionRange(len, len);
          return;
        }
      }
    }
  }

  if (e.key === 'ArrowDown') {
    if (!isAtMenuVisible() && !isSlashMenuVisible() && historyIndex >= 0) {
      if (historyIndex < promptHistory.length - 1) {
        historyIndex++;
        input.value = promptHistory[historyIndex];
        e.preventDefault();
        const len = input.value.length;
        input.setSelectionRange(len, len);
        return;
      } else if (historyIndex === promptHistory.length - 1) {
        historyIndex = promptHistory.length;
        input.value = currentDraft;
        e.preventDefault();
        const len = input.value.length;
        input.setSelectionRange(len, len);
        return;
      }
    }
  }

  if (e.key === 'Enter') {
    if (e.shiftKey) {
      const val = input.value;
      const cursorPos = input.selectionStart;
      const lineEndPos = val.indexOf('\n', cursorPos);
      const currentLine = val.substring(
        val.lastIndexOf('\n', cursorPos - 1) + 1,
        lineEndPos === -1 ? val.length : lineEndPos
      );
      if (currentLine.trim().startsWith('```') && cursorPos >= val.lastIndexOf('```')) {
        e.preventDefault();
        if (lineEndPos === -1) {
          input.value = val + '\n';
          input.selectionStart = input.selectionEnd = input.value.length;
        } else {
          input.selectionStart = input.selectionEnd = lineEndPos + 1;
        }
        adjustInputHeight();
        return;
      }
    } else {
      e.preventDefault();
      sendPrompt();
    }
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
    input.value = item.insertValue + (item.insertValue.endsWith(' ') ? '' : ' ');
  } else {
    input.value = `/${item.name} `;
  }
  hideSlashMenu();
  input.focus();
  const len = input.value.length;
  input.setSelectionRange(len, len);
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

function saveSessionUsage(convId: string | null, usage: any, messageId?: string) {
  if (!usage) return;
  try {
    const targetConvId = convId || activeConversationId;
    const keys: string[] = ['antigravity_latest_usage'];
    if (targetConvId) keys.push(`antigravity_usage_${targetConvId}`);

    for (const key of keys) {
      const raw = localStorage.getItem(key);
      let sessionData: {
        turns: Record<string, { inTokens: number; outTokens: number; thinkTokens: number; cacheTokens: number; sum: number }>;
        totalIn: number;
        totalOut: number;
        totalThink: number;
        totalCache: number;
        totalSum: number;
      } = raw
        ? JSON.parse(raw)
        : { turns: {}, totalIn: 0, totalOut: 0, totalThink: 0, totalCache: 0, totalSum: 0 };

      if (!sessionData.turns || Array.isArray(sessionData.turns)) {
        const oldArray = Array.isArray(sessionData.turns) ? (sessionData.turns as any[]) : [];
        sessionData.turns = {};
        oldArray.forEach((t, idx) => {
          sessionData.turns[`turn_${idx}`] = t;
        });
      }

      const turnKey = messageId || (currentStreamingMessage ? currentStreamingMessage.id : 'latest_turn');

      const inVal = usage.input_tokens || 0;
      const outVal = usage.output_tokens || 0;
      const thinkVal = usage.thinking_tokens || 0;
      const cacheVal = usage.cache_read_tokens || 0;
      const sumVal = usage.total_tokens || (inVal + outVal + thinkVal);

      sessionData.turns[turnKey] = {
        inTokens: inVal,
        outTokens: outVal,
        thinkTokens: thinkVal,
        cacheTokens: cacheVal,
        sum: sumVal,
      };

      let tIn = 0, tOut = 0, tThink = 0, tCache = 0, tSum = 0;
      Object.values(sessionData.turns).forEach((t) => {
        tIn += t.inTokens || 0;
        tOut += t.outTokens || 0;
        tThink += t.thinkTokens || 0;
        tCache += t.cacheTokens || 0;
        tSum += t.sum || 0;
      });

      sessionData.totalIn = tIn;
      sessionData.totalOut = tOut;
      sessionData.totalThink = tThink;
      sessionData.totalCache = tCache;
      sessionData.totalSum = tSum;

      localStorage.setItem(key, JSON.stringify(sessionData));
    }
  } catch (e) {
    console.error('Failed to save session usage:', e);
  }
}

function showUsageOverlay() {
  const existing = document.getElementById('usage-overlay');
  if (existing) {
    existing.remove();
    return;
  }

  let totalIn = 0;
  let totalOut = 0;
  let totalThink = 0;
  let totalCache = 0;
  let totalTokens = 0;

  const rows: Array<{ index: number; role: string; inTokens: number; outTokens: number; thinkTokens: number; sum: number }> = [];
  let turnIdx = 1;

  messages.forEach((msg) => {
    if (msg.tokens) {
      const inVal = msg.tokens.input_tokens || 0;
      const outVal = msg.tokens.output_tokens || 0;
      const thinkVal = msg.tokens.thinking_tokens || 0;
      const cacheVal = (msg.tokens as any).cache_read_tokens || 0;
      const sumVal = msg.tokens.total_tokens || (inVal + outVal + thinkVal);

      totalIn += inVal;
      totalOut += outVal;
      totalThink += thinkVal;
      totalCache += cacheVal;
      totalTokens += sumVal;

      rows.push({
        index: turnIdx++,
        role: msg.role === 'user' ? 'User' : 'Assistant',
        inTokens: inVal,
        outTokens: outVal,
        thinkTokens: thinkVal,
        sum: sumVal,
      });
    }
  });

  if (totalTokens === 0) {
    try {
      let savedRaw = activeConversationId ? localStorage.getItem(`antigravity_usage_${activeConversationId}`) : null;
      if (!savedRaw) {
        savedRaw = localStorage.getItem('antigravity_latest_usage');
      }
      if (savedRaw) {
        const saved = JSON.parse(savedRaw);
        totalIn = saved.totalIn || 0;
        totalOut = saved.totalOut || 0;
        totalThink = saved.totalThink || 0;
        totalCache = saved.totalCache || 0;
        totalTokens = saved.totalSum || (totalIn + totalOut + totalThink);
        if (saved.turns) {
          const turnList = Array.isArray(saved.turns) ? saved.turns : Object.values(saved.turns);
          turnList.forEach((t: any, i: number) => {
            rows.push({
              index: i + 1,
              role: 'Assistant',
              inTokens: t.inTokens || 0,
              outTokens: t.outTokens || 0,
              thinkTokens: t.thinkTokens || 0,
              sum: t.sum || 0,
            });
          });
        }
      }
    } catch (e) {}
  }

  const overlay = document.createElement('div');
  overlay.id = 'usage-overlay';
  overlay.className = 'usage-overlay';

  const fmt = (n: number) => n.toLocaleString();

  let tableHtml = '';
  if (rows.length === 0) {
    tableHtml = `<div class="usage-empty">No token usage metrics recorded for this session yet. Submit a prompt to view token usage.</div>`;
  } else {
    tableHtml = `
      <div class="usage-table-wrapper">
        <table class="usage-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Role</th>
              <th>Input</th>
              <th>Output</th>
              <th>Thinking</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(r => `
              <tr>
                <td>${r.index}</td>
                <td>${r.role}</td>
                <td>${fmt(r.inTokens)}</td>
                <td>${fmt(r.outTokens)}</td>
                <td>${r.thinkTokens ? fmt(r.thinkTokens) : '-'}</td>
                <td><strong>${fmt(r.sum)}</strong></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  const cacheBadge = totalCache > 0 ? `<div class="usage-cache-note">⚡ Cache read tokens: <strong>${fmt(totalCache)}</strong></div>` : '';

  overlay.innerHTML = `
    <div class="usage-card">
      <div class="usage-header">
        <div class="usage-title">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path>
          </svg>
          Session Token Usage Statistics
        </div>
        <button id="usage-close-btn" class="usage-close-btn" title="Close (Esc)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>
      <div class="usage-body">
        <div class="usage-grid">
          <div class="usage-stat-box input">
            <span class="usage-stat-label">Input Tokens</span>
            <span class="usage-stat-value">${fmt(totalIn)}</span>
          </div>
          <div class="usage-stat-box output">
            <span class="usage-stat-label">Output Tokens</span>
            <span class="usage-stat-value">${fmt(totalOut)}</span>
          </div>
          <div class="usage-stat-box thinking">
            <span class="usage-stat-label">Thinking Tokens</span>
            <span class="usage-stat-value">${fmt(totalThink)}</span>
          </div>
          <div class="usage-stat-box total">
            <span class="usage-stat-label">Grand Total</span>
            <span class="usage-stat-value">${fmt(totalTokens)}</span>
          </div>
        </div>
        ${cacheBadge}
        ${tableHtml}
      </div>
      <div class="usage-footer">
        <span class="usage-footer-hint">Press Esc or click outside to close</span>
      </div>
    </div>
  `;

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      overlay.remove();
    }
  });

  document.body.appendChild(overlay);

  document.getElementById('usage-close-btn')?.addEventListener('click', () => {
    overlay.remove();
  });
}

function executeSlashCommand(name: string, arg?: string) {
  if (name === 'usage') {
    showUsageOverlay();
    return;
  }
  if (name === 'clear' || name === 'new') {
    messages = [];
    currentStreamingMessage = null;
    renderAll();
    vscode.postMessage({ command: 'slashCommand', name, arg });
    return;
  }
  if (name === 'settings' || name === 'help' || name === 'sandbox' || name === 'dangerous') {
    vscode.postMessage({ command: 'slashCommand', name, arg });
    return;
  }

  const userText = arg ? `/${name} ${arg}` : `/${name}`;
  messages.push({
    id: `u-${Date.now()}`,
    role: 'user',
    text: userText,
  });

  currentStreamingMessage = {
    id: `a-${Date.now()}`,
    role: 'assistant',
    text: name === 'plan' ? 'Analyzing workspace and generating implementation plan...' : '',
    thinking: '',
    isPlanMode: name === 'plan',
    toolCalls: [],
    isStreaming: true,
  };
  messages.push(currentStreamingMessage);
  renderAll(true);
  setBusy(true);

  vscode.postMessage({ command: 'slashCommand', name, arg });
}

function sendPrompt() {
  const text = input.value.trim();
  if (!text && attachedImages.length === 0) return;

  if (text) {
    if (promptHistory.length === 0 || promptHistory[promptHistory.length - 1] !== text) {
      promptHistory.push(text);
      try {
        localStorage.setItem('antigravity_prompt_history', JSON.stringify(promptHistory));
      } catch (e) {}
    }
    historyIndex = promptHistory.length;
    currentDraft = '';
  }

  const currentMode = activeMode;
  if (currentMode === 'plan') {
    setExecutionMode('default');
  }

  const slashMatch = text.match(/^\/(\S+)\s*(.*)?$/);
  if (slashMatch) {
    const cmdName = slashMatch[1];
    const cmdArg = slashMatch[2]?.trim() || undefined;
    const known = SLASH_COMMANDS.find(c => c.name === cmdName);
    if (known || !cmdName.includes('/')) {
      input.value = '';
      input.style.height = 'auto';
      executeSlashCommand(cmdName, cmdArg);
      return;
    }
  }

  if (currentMode === 'plan') {
    input.value = '';
    input.style.height = 'auto';
    executeSlashCommand('plan', text);
    return;
  }

  const imagesToSend = [...attachedImages];
  attachedImages = [];
  renderImageBar();

  let displayText = text;
  if (imagesToSend.length > 0) {
    const imgLabels = imagesToSend.map(p => `[Image: ${p.split(/[\/\\]/).pop()}]`).join(' ');
    displayText = displayText ? `${imgLabels}\n${displayText}` : imgLabels;
  }

  const isSteering = isBusyState;
  if (isSteering && currentStreamingMessage) {
    currentStreamingMessage.isStreaming = false;
    if (!currentStreamingMessage.text && (!currentStreamingMessage.toolCalls || currentStreamingMessage.toolCalls.length === 0)) {
      currentStreamingMessage.text = '_[Interrupted by mid-turn steering]_';
    }
  }

  messages.push({
    id: `u-${Date.now()}`,
    role: 'user',
    text: isSteering ? `⚡ **[Model Steering]** ${displayText}` : displayText,
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
    dangerouslySkipPermissions: currentMode === 'auto' || undefined,
  });
}

function updateContextHintVisibility() {
  const contextHint = document.getElementById('context-hint');
  if (!contextHint) return;
  const hasActiveFile = !!(contextBar && contextBar.style.display !== 'none' && fileChip && fileChip.textContent);
  const hasImages = attachedImages.length > 0;
  contextHint.style.display = (!hasActiveFile && !hasImages) ? 'inline' : 'none';
}

function renderImageBar() {
  if (!imageBar) return;
  if (attachedImages.length === 0) {
    imageBar.style.display = 'none';
    imageBar.innerHTML = '';
    updateContextHintVisibility();
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
  updateContextHintVisibility();
}

let isBusyState = false;

function setBusy(busy: boolean) {
  isBusyState = busy;
  if (sendBtn) {
    sendBtn.style.display = busy ? 'none' : 'inline-flex';
    sendBtn.title = 'Send prompt (Enter)';
    sendBtn.innerHTML = 'send';
  }
  if (cancelBtn) cancelBtn.style.display = busy ? 'inline-flex' : 'none';
  if (statusEl) {
    statusEl.textContent = busy ? 'thinking... (enter to steer mid-turn)' : 'enter to send, shift+enter for newline';
    statusEl.className = busy ? 'input-hint status-indicator active' : 'input-hint status-indicator';
  }
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
function updateStreamingDOM() {
  if (!currentStreamingMessage || !log) return;

  let activeEl = log.querySelector(`[data-streaming="true"]`) as HTMLElement;
  if (!activeEl) {
    renderAll();
    return;
  }

  if (currentStreamingMessage.thinking && currentStreamingMessage.thinking.trim()) {
    let thinkingInner = activeEl.querySelector('.thinking-body-inner') as HTMLElement;
    if (!thinkingInner) {
      renderAll();
      return;
    }
    thinkingInner.textContent = currentStreamingMessage.thinking;
  }

  if (currentStreamingMessage.text) {
    let bodyEl = activeEl.querySelector('.msg-body') as HTMLElement;
    if (!bodyEl) {
      renderAll();
      return;
    }
    bodyEl.innerHTML = marked.parse(currentStreamingMessage.text) as string;
    applyDiffHighlighting(bodyEl);
    if (currentStreamingMessage.isStreaming) {
      bodyEl.classList.add('streaming-cursor');
    }
  }

  if (isUserScrolledUp) {
    dirtyWhileScrolledUp = true;
    showScrollToBottomPill();
  } else {
    log.scrollTop = log.scrollHeight;
  }
}

function renderAll(autoScrollForce: boolean = false, isUserInteraction: boolean = false) {
  if (!log) return;

  if (isUserScrolledUp && !autoScrollForce && !isUserInteraction) {
    if (dirtyWhileScrolledUp) {
      showScrollToBottomPill();
      return;
    }
  }

  isRendering = true;

  const prevScrollTop = log.scrollTop;
  const prevScrollHeight = log.scrollHeight;
  const distanceFromBottom = prevScrollHeight - prevScrollTop - log.clientHeight;
  const wasAtBottom = distanceFromBottom <= 60;

  if (autoScrollForce) {
    isUserScrolledUp = false;
    dirtyWhileScrolledUp = false;
    hideScrollToBottomPill();
  }

  if (messages.length === 0) {
    renderEmptyState();
    isRendering = false;
    return;
  }

  log.innerHTML = '';

  const isPlanModeActive = (currentStreamingMessage && (currentStreamingMessage as any).isPlanMode) ||
                           messages.some(m => m.plan && !(m.plan as any).cancelled && m.plan.steps.filter((s: any) => s.completed).length < m.plan.steps.length);
  const inputRow = document.querySelector('.input-row') as HTMLElement;
  const contextBar = document.querySelector('.context-bar') as HTMLElement;
  const imageBarEl = document.querySelector('.image-bar') as HTMLElement;
  if (inputRow) inputRow.style.display = isPlanModeActive ? 'none' : '';
  if (contextBar) contextBar.style.display = isPlanModeActive ? 'none' : '';
  if (imageBarEl && attachedImages.length > 0) imageBarEl.style.display = isPlanModeActive ? 'none' : 'flex';

  let activeExecutingPlanMsg: Message | null = null;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].plan) {
      const p = messages[i].plan;
      const done = p.steps.filter((s: any) => s.completed).length;
      if (!p.cancelled && (p as any).isApproved && done < p.steps.length) {
        activeExecutingPlanMsg = messages[i];
        break;
      }
    }
  }

  if (activeExecutingPlanMsg && activeExecutingPlanMsg.plan) {
    const pinnedHeader = document.createElement('div');
    pinnedHeader.className = 'pinned-plan-header';
    pinnedHeader.appendChild(renderPlanCard(activeExecutingPlanMsg.plan));
    log.appendChild(pinnedHeader);
  }

  for (const msg of messages) {
    const isEmptyAssistantMsg = msg.role === 'assistant' &&
                                !msg.isStreaming &&
                                !msg.text &&
                                !msg.thinking &&
                                (!msg.toolCalls || msg.toolCalls.length === 0) &&
                                !msg.plan &&
                                !msg.clarification;
    if (isEmptyAssistantMsg) {
      continue;
    }

    const el = document.createElement('div');
    el.className = `msg msg-${msg.role}`;
    if (msg.isStreaming) {
      el.dataset.streaming = 'true';
    }

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
        const accordion = renderToolCallCard(
          tc,
          (m) => vscode.postMessage(m),
          () => renderAll()
        );
        toolSection.appendChild(accordion);
      }
      el.appendChild(toolSection);
    }

    if (msg.plan && msg !== activeExecutingPlanMsg) {
      el.appendChild(renderPlanCard(msg.plan));
    }

    if (msg.clarification) {
      el.appendChild(renderClarificationCard(msg.clarification));
    }

    const body = document.createElement('div');
    body.className = 'msg-body';
    if (msg.role === 'assistant' && msg.text) {
      body.innerHTML = marked.parse(msg.text) as string;
      applyDiffHighlighting(body);
      if (msg.isStreaming) {
        body.classList.add('streaming-cursor');
      }
    } else if (msg.role === 'assistant' && msg.isStreaming && !msg.text && (!msg.toolCalls || msg.toolCalls.length === 0) && (!msg.thinking || !msg.thinking.trim())) {
      const pulseText = msg.isPlanMode ? 'Analyzing workspace & generating implementation plan...' : 'Processing request...';
      body.innerHTML = `<div class="thinking-pulse"><span class="thinking-pulse-dot"></span><span>${pulseText}</span></div>`;
    } else if (msg.role === 'user' && msg.text) {
      body.innerHTML = marked.parse(msg.text) as string;
    } else {
      body.textContent = msg.text || '';
    }
    if (body.innerHTML.trim() || body.textContent?.trim()) {
      el.appendChild(body);
    }

    if (msg.tokens && (msg.tokens.input_tokens || msg.tokens.output_tokens)) {
      const usage = document.createElement('div');
      usage.className = 'usage-bar';
      const inVal = msg.tokens.input_tokens || 0;
      const outVal = msg.tokens.output_tokens || 0;
      let html = `<span class="usage-label">in:</span> ${inVal} <span class="usage-sep">/</span> <span class="usage-label">out:</span> ${outVal}`;
      if (msg.tokens.thinking_tokens) {
        html += ` <span class="usage-sep">/</span> <span class="usage-label">think:</span> ${msg.tokens.thinking_tokens}`;
      }
      usage.innerHTML = html;
      el.appendChild(usage);
    }

    log.appendChild(el);
  }

  attachCopyButtons(log);
  attachInlineCodeCopyHandlers(log);
  renderMermaidDiagrams(log);

  requestAnimationFrame(() => {
    if (autoScrollForce || wasAtBottom) {
      log.scrollTop = log.scrollHeight;
    }
    isRendering = false;
  });

  const toSave = messages.filter(m => !m.isStreaming);
  vscode.setState({ messages: toSave });
}

let mermaidInitialized = false;
function initMermaid() {
  if (mermaidInitialized) return;
  const isDark = !document.body.classList.contains('vscode-light');
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'loose',
    theme: isDark ? 'dark' : 'default',
    fontFamily: 'var(--font-mono, Consolas, monospace)',
  });
  mermaidInitialized = true;
}

let mermaidCounter = 0;

async function renderMermaidDiagrams(container: HTMLElement) {
  const mermaidBlocks = container.querySelectorAll<HTMLElement>('pre code.language-mermaid, pre code.lang-mermaid');
  if (mermaidBlocks.length === 0) return;

  initMermaid();

  for (const codeEl of Array.from(mermaidBlocks)) {
    const pre = codeEl.closest('pre');
    if (!pre || pre.dataset.mermaidProcessed === 'true') continue;
    pre.dataset.mermaidProcessed = 'true';

    const mermaidCode = codeEl.textContent || '';
    if (!mermaidCode.trim()) continue;

    const card = document.createElement('div');
    card.className = 'mermaid-card';

    const header = document.createElement('div');
    header.className = 'mermaid-header';

    const titleEl = document.createElement('div');
    titleEl.className = 'mermaid-title';
    titleEl.innerHTML = `<span class="mermaid-icon">📊</span><span>Mermaid Diagram</span>`;

    const actions = document.createElement('div');
    actions.className = 'mermaid-actions';

    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'mermaid-btn';
    toggleBtn.textContent = 'Code';
    toggleBtn.title = 'Toggle Code/Diagram';

    const copySvgBtn = document.createElement('button');
    copySvgBtn.className = 'mermaid-btn';
    copySvgBtn.textContent = 'Copy SVG';
    copySvgBtn.title = 'Copy SVG Image';

    const copyCodeBtn = document.createElement('button');
    copyCodeBtn.className = 'mermaid-btn';
    copyCodeBtn.textContent = 'Copy Code';
    copyCodeBtn.title = 'Copy Mermaid Source Code';

    const expandBtn = document.createElement('button');
    expandBtn.className = 'mermaid-btn mermaid-btn-highlight';
    expandBtn.textContent = '🔍 Expand';
    expandBtn.title = 'Open Fullscreen Pan & Zoom View';

    actions.appendChild(toggleBtn);
    actions.appendChild(copySvgBtn);
    actions.appendChild(copyCodeBtn);
    actions.appendChild(expandBtn);

    header.appendChild(titleEl);
    header.appendChild(actions);

    const viewport = document.createElement('div');
    viewport.className = 'mermaid-viewport';

    const sourceWrapper = document.createElement('div');
    sourceWrapper.className = 'mermaid-source-wrapper';
    sourceWrapper.style.display = 'none';

    const preClone = pre.cloneNode(true) as HTMLElement;
    sourceWrapper.appendChild(preClone);

    const errorBanner = document.createElement('div');
    errorBanner.className = 'mermaid-error';
    errorBanner.style.display = 'none';

    card.appendChild(header);
    card.appendChild(viewport);
    card.appendChild(sourceWrapper);
    card.appendChild(errorBanner);

    pre.parentNode?.replaceChild(card, pre);

    let showingSource = false;
    toggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      showingSource = !showingSource;
      sourceWrapper.style.display = showingSource ? 'block' : 'none';
      viewport.style.display = showingSource ? 'none' : 'flex';
      toggleBtn.textContent = showingSource ? 'Diagram' : 'Code';
    });

    copySvgBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const svgEl = viewport.querySelector('svg');
      if (svgEl) {
        copyTextToClipboard(svgEl.outerHTML, copySvgBtn);
      }
    });

    copyCodeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      copyTextToClipboard(mermaidCode.trim(), copyCodeBtn);
    });

    expandBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openMermaidModal(mermaidCode, viewport.innerHTML);
    });

    const svgId = `mermaid-render-${++mermaidCounter}`;
    try {
      const { svg } = await mermaid.render(svgId, mermaidCode);
      viewport.innerHTML = svg;
    } catch (err: any) {
      errorBanner.textContent = `Mermaid syntax notice: ${err?.message || 'Rendering error'}`;
      errorBanner.style.display = 'block';
      sourceWrapper.style.display = 'block';
      viewport.style.display = 'none';
      toggleBtn.textContent = 'Diagram';
    }
  }
}

let modalOverlay: HTMLElement | null = null;
let currentZoom = 1;
let currentPanX = 0;
let currentPanY = 0;

function openMermaidModal(code: string, svgHtml: string) {
  if (!modalOverlay) {
    modalOverlay = document.createElement('div');
    modalOverlay.id = 'mermaid-modal-overlay';
    document.body.appendChild(modalOverlay);
  }

  modalOverlay.innerHTML = `
    <div class="mermaid-modal-dialog">
      <div class="mermaid-modal-header">
        <div class="mermaid-modal-title">
          <span>📊</span>
          <span>Mermaid Diagram - Fullscreen View</span>
        </div>
        <div class="mermaid-modal-controls">
          <span class="mermaid-modal-zoom-level" id="mermaid-zoom-val">100%</span>
          <button class="mermaid-modal-btn" id="mermaid-zoom-in" title="Zoom In (+)">+</button>
          <button class="mermaid-modal-btn" id="mermaid-zoom-out" title="Zoom Out (-)">-</button>
          <button class="mermaid-modal-btn" id="mermaid-zoom-reset" title="Reset View (1:1)">1:1</button>
          <button class="mermaid-modal-btn mermaid-modal-close" id="mermaid-modal-close" title="Close (Esc)">✕</button>
        </div>
      </div>
      <div class="mermaid-modal-body" id="mermaid-modal-body">
        <div class="mermaid-modal-canvas" id="mermaid-modal-canvas">
          ${svgHtml}
        </div>
      </div>
    </div>
  `;

  modalOverlay.style.display = 'flex';

  const canvas = modalOverlay.querySelector('#mermaid-modal-canvas') as HTMLElement;
  const body = modalOverlay.querySelector('#mermaid-modal-body') as HTMLElement;
  const zoomVal = modalOverlay.querySelector('#mermaid-zoom-val') as HTMLElement;

  currentZoom = 1;
  currentPanX = 0;
  currentPanY = 0;

  function updateTransform() {
    if (!canvas) return;
    canvas.style.transform = `translate(${currentPanX}px, ${currentPanY}px) scale(${currentZoom})`;
    if (zoomVal) zoomVal.textContent = `${Math.round(currentZoom * 100)}%`;
  }

  updateTransform();

  modalOverlay.querySelector('#mermaid-zoom-in')?.addEventListener('click', () => {
    currentZoom = Math.min(5, currentZoom + 0.25);
    updateTransform();
  });

  modalOverlay.querySelector('#mermaid-zoom-out')?.addEventListener('click', () => {
    currentZoom = Math.max(0.2, currentZoom - 0.25);
    updateTransform();
  });

  modalOverlay.querySelector('#mermaid-zoom-reset')?.addEventListener('click', () => {
    currentZoom = 1;
    currentPanX = 0;
    currentPanY = 0;
    updateTransform();
  });

  const closeModal = () => {
    if (modalOverlay) modalOverlay.style.display = 'none';
    document.removeEventListener('keydown', handleKeydown);
  };

  modalOverlay.querySelector('#mermaid-modal-close')?.addEventListener('click', closeModal);

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') closeModal();
  }
  document.addEventListener('keydown', handleKeydown);

  body?.addEventListener('wheel', (e) => {
    e.preventDefault();
    const delta = e.deltaY < 0 ? 0.15 : -0.15;
    currentZoom = Math.min(5, Math.max(0.2, currentZoom + delta));
    updateTransform();
  }, { passive: false });

  let isDragging = false;
  let startX = 0;
  let startY = 0;

  body?.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    isDragging = true;
    startX = e.clientX - currentPanX;
    startY = e.clientY - currentPanY;
    body.style.cursor = 'grabbing';
  });

  window.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    currentPanX = e.clientX - startX;
    currentPanY = e.clientY - startY;
    updateTransform();
  });

  window.addEventListener('mouseup', () => {
    if (isDragging) {
      isDragging = false;
      if (body) body.style.cursor = 'grab';
    }
  });
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

  if (data.command === 'configUpdate' || data.type === 'configUpdate') {
    if (data.dangerouslySkipPermissions === true) {
      setExecutionMode('auto');
    } else if (data.dangerouslySkipPermissions === false && activeMode === 'auto') {
      setExecutionMode('default');
    }

    const sandboxTextEl = document.getElementById('sandbox-text');
    if (sandboxTextEl) {
      if (data.bypassSandbox === true) {
        sandboxTextEl.innerHTML = '<span style="color: #eab308;">sandbox off</span>';
        sandboxTextEl.className = 'mode-text';
        sandboxTextEl.style.display = 'inline-block';
      } else {
        sandboxTextEl.innerHTML = '<span style="color: #eab308;">sandbox</span> <span style="color: var(--vscode-charts-green, #4ec9b0);">on</span>';
        sandboxTextEl.className = 'mode-text';
        sandboxTextEl.style.display = 'inline-block';
      }
    }
  }

  switch (data.type) {
    case 'focusInput':
      input?.focus();
      break;
    case 'permissionRequest':
      setBusy(false);
      renderPermissionPromptCard(data.promptText);
      break;
    case 'textDelta':
      if (isUserScrolledUp) dirtyWhileScrolledUp = true;
      if (currentStreamingMessage) {
        currentStreamingMessage.text += data.delta;
        updateStreamingDOM();
      }
      break;

    case 'thinkingDelta':
      if (isUserScrolledUp) dirtyWhileScrolledUp = true;
      if (currentStreamingMessage) {
        currentStreamingMessage.thinking = (currentStreamingMessage.thinking || '') + data.delta;
        updateStreamingDOM();
      }
      break;

    case 'toolCall': {
      if (isUserScrolledUp) dirtyWhileScrolledUp = true;
      const targetMsg = currentStreamingMessage || [...messages].reverse().find(m => m.role === 'assistant');
      if (targetMsg) {
        if (!targetMsg.toolCalls) targetMsg.toolCalls = [];
        
        const rawName = (data.name || '').toLowerCase();
        const isGenericName = !rawName || ['tool', 'tool_call', 'tool_use', 'tool execution', 'tool_execution'].includes(rawName);
        
        if (isGenericName && !data.args && !data.result && !data.id) {
          break;
        }

        let existing = data.id !== undefined && data.id !== null
          ? targetMsg.toolCalls.find(tc => tc.id === data.id)
          : null;

        if (!existing && data.name && !isGenericName) {
          existing = [...targetMsg.toolCalls].reverse().find(
            tc => tc.name.toLowerCase() === data.name.toLowerCase() && tc.status === 'running'
          ) || null;
        }

        if (!existing && data.result && typeof data.result === 'string' && data.result.includes('[diff_block_start]')) {
          existing = [...targetMsg.toolCalls].reverse().find(
            tc => (tc.name.toLowerCase().includes('replace') || tc.name.toLowerCase().includes('write') || tc.name.toLowerCase().includes('edit')) && tc.status === 'running'
          ) || null;
        }

        if (existing) {
          if (data.id && !existing.id) existing.id = data.id;
          if (data.name && !isGenericName) existing.name = data.name;
          if (data.args !== undefined && data.args !== null) {
            const existingParsed = parseJsonArgs(existing.args);
            const newParsed = parseJsonArgs(data.args);
            if (existingParsed && typeof existingParsed === 'object' && newParsed && typeof newParsed === 'object') {
              const merged: Record<string, any> = { ...existingParsed, ...newParsed };
              for (const k of Object.keys(existingParsed)) {
                if (merged[k] === undefined || merged[k] === null || merged[k] === '') {
                  merged[k] = (existingParsed as Record<string, any>)[k];
                }
              }
              existing.args = merged;
            } else if (existingParsed && typeof existingParsed === 'object') {
              existing.args = existingParsed;
            } else {
              existing.args = newParsed || data.args;
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
          const parsedArgs = parseJsonArgs(data.args);
          targetMsg.toolCalls.push({
            id: data.id,
            name: (data.name && !isGenericName) ? data.name : 'Tool Execution',
            args: parsedArgs || data.args,
            status: data.status || 'done',
            result: data.result,
            expanded: isPermError || data.status === 'error',
          });
        }
        renderAll();
      }
      break;
    }

    case 'stepComplete':
      if (currentStreamingMessage && data.usage) {
        currentStreamingMessage.tokens = data.usage;
        saveSessionUsage(data.conversationId || activeConversationId, data.usage, currentStreamingMessage.id);
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
          saveSessionUsage(data.conversationId || activeConversationId, data.usage, currentStreamingMessage.id);
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

    case 'planCreated': {
      if (data.plan) {
        const targetPath = (data.plan.filePath || '').toLowerCase().replace(/\\/g, '/');
        for (const m of messages) {
          if (m.plan) {
            const mPath = (m.plan.filePath || '').toLowerCase().replace(/\\/g, '/');
            if (mPath === targetPath || mPath.endsWith(targetPath) || targetPath.endsWith(mPath) || (!m.plan.isApproved && !(m.plan as any).cancelled)) {
              delete m.plan;
            }
          }
        }
        if (currentStreamingMessage) {
          currentStreamingMessage.plan = data.plan;
        } else {
          const planMsg: Message = {
            id: `plan-${Date.now()}`,
            role: 'assistant',
            text: '',
            thinking: '',
            plan: data.plan,
          };
          messages.push(planMsg);
        }
        renderAll(true);
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
          fileChip.textContent = '';
        }
        updateContextHintVisibility();
      }
      break;

    case 'steeringPivot':
      break;

    case 'cancelled':
      setBusy(false);
      if (currentStreamingMessage) {
        currentStreamingMessage.isStreaming = false;
        if (!currentStreamingMessage.text) {
          currentStreamingMessage.text = '[cancelled]';
        }
      }
      currentStreamingMessage = null;
      for (const m of messages) {
        if (m.plan) {
          (m.plan as any).cancelled = true;
        }
      }
      const inputAreaEl = document.querySelector('.input-area') as HTMLElement;
      if (inputAreaEl) inputAreaEl.style.display = '';
      renderAll();
      break;

    case 'processExit':
      setBusy(false);
      if (currentStreamingMessage) {
        currentStreamingMessage.isStreaming = false;
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
      if (data.workspaceInfo) {
        updateWorkspaceHeaderBadge(data.workspaceInfo);
      }
      renderHistoryDropdown(data.sessions, data.currentId);
      break;

    case 'sessionLoaded': {
      activeConversationId = data.conversationId;
      messages = [];
      currentStreamingMessage = null;

      if (data.workspaceInfo) {
        updateWorkspaceHeaderBadge(data.workspaceInfo);
      }

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
                text: evt.text,
                tokens: evt.usage
              };
              messages.push(currentAssistantMsg);
            } else {
              currentAssistantMsg.text = (currentAssistantMsg.text ? currentAssistantMsg.text + '\n' : '') + evt.text;
              if (evt.usage) {
                currentAssistantMsg.tokens = evt.usage;
              }
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


let cachedSessionsList: Array<{ id: string; title: string; updatedAt: number; relativeTime: string; workspacePath?: string; workspaceName?: string; workspaceMatch?: boolean }> = [];

function updateWorkspaceHeaderBadge(info?: { name: string; path: string } | null) {
  const badge = document.getElementById('header-workspace-badge');
  if (!badge) return;
  if (info && info.name) {
    badge.textContent = `📁 ${info.name}`;
    badge.title = `Workspace: ${info.path}`;
    badge.style.display = 'inline-flex';
  } else {
    badge.style.display = 'none';
  }
}

function renderHistoryDropdown(sessions: Array<{ id: string; title: string; updatedAt: number; relativeTime: string; workspacePath?: string; workspaceName?: string; workspaceMatch?: boolean }>, currentId?: string | null) {
  if (!historyDropdown) return;
  cachedSessionsList = sessions || [];
  renderFilteredSessions(cachedSessionsList, currentId, '');
}

function renderFilteredSessions(sessions: Array<{ id: string; title: string; updatedAt: number; relativeTime: string; workspacePath?: string; workspaceName?: string; workspaceMatch?: boolean }>, currentId?: string | null, searchQuery = '') {
  if (!historyDropdown) return;

  const query = searchQuery.trim().toLowerCase();
  const filtered = query
    ? sessions.filter(s => s.title.toLowerCase().includes(query) || s.id.toLowerCase().includes(query) || (s.workspaceName && s.workspaceName.toLowerCase().includes(query)))
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
        No matching sessions found for this workspace.
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

function renderPlanCard(plan: { filePath: string; timestamp: string; title: string; steps: Array<{ id: string; text: string; completed: boolean }> }): HTMLElement {
  const isCancelled = !!(plan as any).cancelled;
  if (isCancelled) {
    const card = document.createElement('div');
    card.className = 'plan-card cancelled';
    card.innerHTML = `
      <div class="plan-header">
        <div class="plan-title-group">
          <span class="plan-badge cancelled">❌ Plan Cancelled</span>
          <span class="plan-title">${esc(plan.title || 'Plan')}</span>
        </div>
      </div>
      <div style="font-size: 11px; color: var(--text-secondary); margin-top: 6px;">
        This implementation plan was cancelled.
      </div>
    `;
    return card;
  }

  const completedCount = plan.steps.filter(s => s.completed).length;
  const totalCount = plan.steps.length;
  const pct = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;
  const isCompleted = totalCount > 0 && completedCount === totalCount;

  const card = document.createElement('div');
  card.className = `plan-card${isCompleted ? ' completed' : ' sticky'}`;

  const header = document.createElement('div');
  header.className = 'plan-header';

  const titleGroup = document.createElement('div');
  titleGroup.className = 'plan-title-group';

  const badge = document.createElement('span');
  badge.className = `plan-badge${isCompleted ? ' completed' : ''}`;
  badge.textContent = isCompleted ? '✓ Plan Complete' : 'Plan';
  titleGroup.appendChild(badge);

  const titleEl = document.createElement('span');
  titleEl.className = 'plan-title';
  titleEl.textContent = plan.title || 'Implementation Plan';
  titleGroup.appendChild(titleEl);

  header.appendChild(titleGroup);

  const openBtn = document.createElement('button');
  openBtn.className = 'plan-open-btn';
  openBtn.innerHTML = '📄 Open in Editor ↗';
  openBtn.onclick = (e) => {
    e.stopPropagation();
    vscode.postMessage({ command: 'openPlanFile', filePath: plan.filePath });
  };
  header.appendChild(openBtn);
  card.appendChild(header);

  const progressContainer = document.createElement('div');
  progressContainer.className = 'plan-progress-container';
  progressContainer.innerHTML = `
    <div class="plan-progress-bar-bg">
      <div class="plan-progress-bar-fill" style="width: ${pct}%;"></div>
    </div>
    <div class="plan-progress-text">
      <span>${completedCount} of ${totalCount} tasks completed</span>
      <span>${pct}%</span>
    </div>
  `;
  card.appendChild(progressContainer);

  const checklist = document.createElement('div');
  checklist.className = 'plan-checklist';

  plan.steps.forEach((step, idx) => {
    const item = document.createElement('div');
    item.className = `plan-step-item${step.completed ? ' completed' : ''}`;

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'plan-step-checkbox';
    cb.checked = step.completed;
    cb.disabled = true;

    const label = document.createElement('span');
    label.className = 'plan-step-text';
    label.textContent = step.text;

    item.appendChild(cb);
    item.appendChild(label);
    checklist.appendChild(item);
  });

  card.appendChild(checklist);

  const isApproved = !!(plan as any).isApproved;
  if (!isApproved && !isCancelled && !isCompleted && completedCount === 0) {
    const actions = document.createElement('div');
    actions.className = 'plan-actions';

    const approveBtn = document.createElement('button');
    approveBtn.className = 'plan-btn plan-btn-primary';
    approveBtn.textContent = '✓ Approve & Execute Plan';
    approveBtn.onclick = (e) => {
      e.stopPropagation();
      (plan as any).isApproved = true;
      actions.remove();

      const displayUserText = `Proceeding with implementation plan (${plan.title || 'Plan'}).`;
      const fullSystemPrompt = `[EXECUTE PLAN] Read the implementation plan at "${plan.filePath}" and immediately execute every task step-by-step using your file writing and command tools. As you complete each task, update the checklist in "${plan.filePath}" by marking '[x]'.`;

      currentStreamingMessage = {
        id: `a-${Date.now()}`,
        role: 'assistant',
        text: '',
        thinking: '',
        toolCalls: [],
        isStreaming: true,
      };
      messages.push({
        id: `u-${Date.now()}`,
        role: 'user',
        text: displayUserText,
      });
      messages.push(currentStreamingMessage);
      renderAll(true);
      setBusy(true);

      vscode.postMessage({ command: 'userPrompt', promptText: fullSystemPrompt, images: [] });
    };
    actions.appendChild(approveBtn);

    const modifyBtn = document.createElement('button');
    modifyBtn.className = 'plan-btn plan-btn-secondary';
    modifyBtn.textContent = '✏️ Modify Plan';
    modifyBtn.onclick = (e) => {
      e.stopPropagation();
      actions.style.display = 'none';

      const modifyForm = document.createElement('div');
      modifyForm.className = 'plan-modify-form';

      const modifyInput = document.createElement('textarea');
      modifyInput.className = 'plan-modify-input';
      modifyInput.rows = 2;
      modifyInput.value = '';
      modifyInput.placeholder = 'Describe edits to the plan... (e.g. add new feature, update layout)';

      const modifyActions = document.createElement('div');
      modifyActions.className = 'plan-modify-actions';

      const submitBtn = document.createElement('button');
      submitBtn.className = 'plan-btn plan-btn-primary';
      submitBtn.textContent = '🚀 Submit Edits';

      const cancelFormBtn = document.createElement('button');
      cancelFormBtn.className = 'plan-btn plan-btn-secondary';
      cancelFormBtn.textContent = 'Cancel';

      const submitEdit = () => {
        const rawText = modifyInput.value.trim();
        if (!rawText) return;
        modifyForm.remove();
        
        const text = rawText.startsWith('Edits to the plan:') ? rawText : `Edits to the plan: ${rawText}`;

        messages.push({
          id: `u-${Date.now()}`,
          role: 'user',
          text,
        });

        currentStreamingMessage = {
          id: `a-${Date.now()}`,
          role: 'assistant',
          text: 'Updating implementation plan...',
          thinking: '',
          isPlanMode: true,
          toolCalls: [],
          isStreaming: true,
        };
        messages.push(currentStreamingMessage);
        renderAll(true);
        setBusy(true);

        vscode.postMessage({ command: 'userPrompt', promptText: text, images: [] });
      };

      submitBtn.onclick = (ev) => {
        ev.stopPropagation();
        submitEdit();
      };

      cancelFormBtn.onclick = (ev) => {
        ev.stopPropagation();
        modifyForm.remove();
        actions.style.display = 'flex';
      };

      modifyInput.onkeydown = (ev) => {
        if (ev.key === 'Enter' && !ev.shiftKey) {
          ev.preventDefault();
          submitEdit();
        } else if (ev.key === 'Escape') {
          ev.preventDefault();
          modifyForm.remove();
          actions.style.display = 'flex';
        }
      };

      modifyActions.appendChild(submitBtn);
      modifyActions.appendChild(cancelFormBtn);
      modifyForm.appendChild(modifyInput);
      modifyForm.appendChild(modifyActions);

      card.appendChild(modifyForm);

      setTimeout(() => {
        modifyInput.focus();
        const len = modifyInput.value.length;
        modifyInput.setSelectionRange(len, len);
        modifyForm.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }, 50);
    };
    actions.appendChild(modifyBtn);

    const cancelPlanBtn = document.createElement('button');
    cancelPlanBtn.className = 'plan-btn plan-btn-secondary';
    cancelPlanBtn.textContent = '❌ Cancel Plan';
    cancelPlanBtn.onclick = (e) => {
      e.stopPropagation();
      (plan as any).cancelled = true;
      actions.remove();
      const inputArea = document.querySelector('.input-area') as HTMLElement;
      if (inputArea) inputArea.style.display = '';
      vscode.postMessage({ command: 'cancel' });
      setBusy(false);
      renderAll();
    };
    actions.appendChild(cancelPlanBtn);
    card.appendChild(actions);
  }

  if (isApproved && !isCompleted) {
    const execBar = document.createElement('div');
    execBar.className = 'plan-exec-bar';
    execBar.innerHTML = `<span class="plan-exec-status">⚡ Executing Plan Step-by-Step...</span>`;
    
    const cancelExecBtn = document.createElement('button');
    cancelExecBtn.className = 'plan-btn plan-btn-secondary plan-btn-cancel-exec';
    cancelExecBtn.textContent = '❌ Cancel Execution';
    cancelExecBtn.onclick = (e) => {
      e.stopPropagation();
      (plan as any).cancelled = true;
      vscode.postMessage({ command: 'cancel' });
      setBusy(false);
      renderAll();
    };
    execBar.appendChild(cancelExecBtn);
    card.appendChild(execBar);
  }

  return card;
}

function renderClarificationCard(q: { question: string; options?: string[]; isMultiSelect?: boolean }): HTMLElement {
  const card = document.createElement('div');
  card.className = 'clarification-card';

  const title = document.createElement('div');
  title.className = 'clarification-title';
  title.innerHTML = `<span>❓ Clarification Required:</span> ${esc(q.question)}`;
  card.appendChild(title);

  const optionsContainer = document.createElement('div');
  optionsContainer.className = 'clarification-options';

  const inputType = q.isMultiSelect ? 'checkbox' : 'radio';
  const groupName = `clarification_${Date.now()}`;

  if (q.options && q.options.length > 0) {
    q.options.forEach((optText) => {
      const label = document.createElement('label');
      label.className = 'clarification-option-label';

      const optInput = document.createElement('input');
      optInput.type = inputType;
      optInput.name = groupName;
      optInput.value = optText;

      const txt = document.createElement('span');
      txt.textContent = optText;

      label.appendChild(optInput);
      label.appendChild(txt);
      optionsContainer.appendChild(label);
    });
  }

  card.appendChild(optionsContainer);

  const customInput = document.createElement('input');
  customInput.type = 'text';
  customInput.className = 'clarification-input';
  customInput.placeholder = 'Or type custom guidance / additional instructions...';
  card.appendChild(customInput);

  const actions = document.createElement('div');
  actions.className = 'plan-actions';

  const submitBtn = document.createElement('button');
  submitBtn.className = 'plan-btn plan-btn-primary';
  submitBtn.textContent = 'Submit Response';
  submitBtn.onclick = (e) => {
    e.stopPropagation();
    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitted...';

    const checkedInputs = optionsContainer.querySelectorAll('input:checked');
    const answers: string[] = [];
    checkedInputs.forEach((el: any) => answers.push(el.value));

    const customText = customInput.value.trim();
    if (customText) answers.push(`Custom: ${customText}`);

    const responseMsg = answers.length > 0 ? `Selected choices: ${answers.join(' | ')}` : 'Proceed with default options.';

    if (input) {
      input.value = responseMsg;
      const form = input.closest('form') || input.parentElement;
      if (form) form.dispatchEvent(new Event('submit', { cancelable: true }));
    }
  };
  actions.appendChild(submitBtn);

  card.appendChild(actions);

  return card;
}

vscode.postMessage({ command: 'ready' });

