import { marked } from 'marked';
import { Message } from './types';
import { esc } from './utils/escape';
import { parseJsonArgs } from './utils/formatters';
import { isDiffText, renderDiffOrTextHtml } from './utils/diffBuilder';
import { renderToolCallCard } from './components/toolCard';
import { initAtMenu, setAtFilteredFiles, getAtMatch, isAtMenuVisible, updateAtMenu, hideAtMenu, acceptAtItem, navigateAtMenu } from './controllers/atMenuController';
import { initMermaidController, renderMermaidDiagrams } from './controllers/mermaidModal';
import { initSlashMenu, setSlashCommands, isSlashMenuVisible, updateSlashMenu, hideSlashMenu, acceptSlashItem, navigateSlashMenu, getSlashCommands } from './controllers/slashMenuController';
import { initScrollManager, isUserScrolledUp, dirtyWhileScrolledUp, isRendering, setIsRendering, setDirtyWhileScrolledUp, resetScrollState, showScrollToBottomPill, hideScrollToBottomPill, scrollToBottom, getScrollMetrics } from './controllers/scrollManager';
import { saveSessionUsage, showUsageOverlay } from './controllers/usageTracker';
import { initSessionHistory, updateWorkspaceHeaderBadge, renderHistoryDropdown } from './controllers/sessionHistory';
import { initPlanCard, renderPlanCard, renderClarificationCard } from './controllers/planCard';
import { initTaskTracker, processToolCallForTasks, clearTaskTracker, getRunningTaskIds } from './controllers/taskTracker';

marked.setOptions({ breaks: true, gfm: true });

declare function acquireVsCodeApi(): any;
const vscode = acquireVsCodeApi();



const savedState = vscode.getState() as { messages?: Message[] } | undefined;
let messages: Message[] = savedState?.messages || [];
let currentStreamingMessage: Message | null = null;
let activeConversationId: string | null = null;

let attachedImages: string[] = [];
let botDisplayName = 'antigravity';
let isWebMode = false;

const log = document.getElementById('chat-messages') as HTMLElement;

if (log) {
  initScrollManager(log, () => renderAll(true));
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
const planConfirmBar = document.getElementById('plan-confirm-bar') as HTMLElement;
const planConfirmYes = document.getElementById('plan-confirm-yes') as HTMLButtonElement;
const planConfirmNo = document.getElementById('plan-confirm-no') as HTMLButtonElement;

planConfirmYes.addEventListener('click', () => {
  planConfirmBar.style.display = 'none';
  vscode.postMessage({ command: 'planConfirmResponse', choice: 'yes' });
});
planConfirmNo.addEventListener('click', () => {
  planConfirmBar.style.display = 'none';
  vscode.postMessage({ command: 'planConfirmResponse', choice: 'no' });
});
const fileChip = document.getElementById('active-file-context') as HTMLElement;
const contextBar = document.getElementById('context-bar') as HTMLElement;
const slashMenu = document.getElementById('slash-menu') as HTMLElement;
const atMenu = document.getElementById('at-menu') as HTMLElement;

initAtMenu(input, atMenu, (msg: any) => vscode.postMessage(msg));
initSlashMenu(input, slashMenu);
initMermaidController(copyTextToClipboard);
initTaskTracker(
  document.getElementById('task-tracker') as HTMLElement,
  (msg: any) => vscode.postMessage(msg)
);
initSessionHistory(historyDropdown, (msg: any) => vscode.postMessage(msg));
initPlanCard({
  getMessages: () => messages,
  pushMessage: (msg) => messages.push(msg),
  setCurrentStreamingMessage: (msg) => { currentStreamingMessage = msg; },
  renderAll: (autoScroll, isUser) => renderAll(autoScroll, isUser),
  setBusy,
  postMessage: (msg) => vscode.postMessage(msg),
  getInput: () => input,
  sendPrompt,
});

let workspaceKey = '';
let promptHistory: string[] = [];
let historyIndex = 0;
let currentDraft = '';

function historyStorageKey() {
  return workspaceKey ? `antigravity_prompt_history_${workspaceKey}` : 'antigravity_prompt_history';
}

function loadPromptHistory() {
  promptHistory = [];
  try {
    const saved = localStorage.getItem(historyStorageKey());
    if (saved) promptHistory = JSON.parse(saved);
  } catch {}
  historyIndex = promptHistory.length;
  currentDraft = '';
}

function savePromptHistory() {
  try {
    localStorage.setItem(historyStorageKey(), JSON.stringify(promptHistory));
  } catch {}
}

function setWorkspaceKey(name: string) {
  if (!name || workspaceKey === name) return;
  workspaceKey = name;
  loadPromptHistory();
}

let resourceMappings: Array<{ prefix: string; base: string }> = [];

function rewriteImageSources(container: HTMLElement) {
  if (resourceMappings.length === 0) return;
  container.querySelectorAll('img').forEach((img) => {
    const src = img.getAttribute('src');
    if (!src || src.startsWith('https://') || src.startsWith('http://') || src.startsWith('data:') || src.startsWith('vscode-webview-resource:')) return;
    const normalized = src.replace(/\\/g, '/');
    for (const m of resourceMappings) {
      const prefix = m.prefix.replace(/\\/g, '/');
      if (normalized.startsWith(prefix)) {
        const relative = normalized.slice(prefix.length).replace(/^\//, '');
        img.src = `${m.base}/${relative}`;
        return;
      }
    }
  });
}

loadPromptHistory();

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
      navigateAtMenu('down');
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      navigateAtMenu('up');
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
      navigateSlashMenu('down');
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      navigateSlashMenu('up');
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
  clearTaskTracker();
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
        if (!isWebMode) {
          vscode.postMessage({ command: 'openFile', filePath: href });
        }
        return;
      }
    }
  }

  const clickableFile = target.closest('.clickable-file');
  if (clickableFile && !isWebMode) {
    const pathAttr = clickableFile.getAttribute('data-path');
    if (pathAttr) {
      vscode.postMessage({ command: 'openFile', filePath: pathAttr });
    }
  }

  if (target.tagName === 'IMG' && !isWebMode) {
    const src = (target as HTMLImageElement).src;
    if (src && !src.startsWith('data:')) {
      vscode.postMessage({ command: 'openFile', filePath: src });
    }
  }
});

function executeSlashCommand(name: string, arg?: string) {
  if (name === 'usage') {
    showUsageOverlay(messages, activeConversationId);
    return;
  }
  if (name === 'clear' || name === 'new') {
    messages = [];
    currentStreamingMessage = null;
    renderAll();
    vscode.postMessage({ command: 'slashCommand', name, arg });
    return;
  }
  if (name === 'settings' || name === 'help' || name === 'sandbox' || name === 'dangerous' || name === 'effort') {
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
      savePromptHistory();
    }
    historyIndex = promptHistory.length;
    currentDraft = '';
  }

  const currentMode = activeMode;
  if (currentMode === 'plan') {
    setExecutionMode('default');
  }

  const planAnywhere = text.match(/\/plan\b\s*(.*)/i);
  if (planAnywhere) {
    const before = text.slice(0, planAnywhere.index!).trim();
    const after = (planAnywhere[1] || '').trim();
    const planArg = [before, after].filter(Boolean).join(' ') || undefined;
    input.value = '';
    input.style.height = 'auto';
    executeSlashCommand('plan', planArg);
    return;
  }

  const enterPlanMatch = text.match(/\benter\s+plan\s+mode\b\s*(.*)/i);
  if (enterPlanMatch) {
    const before = text.slice(0, enterPlanMatch.index!).trim();
    const after = (enterPlanMatch[1] || '').trim();
    const planArg = [before, after].filter(Boolean).join(' ') || undefined;
    input.value = '';
    input.style.height = 'auto';
    executeSlashCommand('plan', planArg);
    return;
  }

  const slashMatch = text.match(/^\/(\S+)\s*(.*)?$/);
  if (slashMatch) {
    const cmdName = slashMatch[1];
    const cmdArg = slashMatch[2]?.trim() || undefined;
    const known = getSlashCommands().find(c => c.name === cmdName);
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
    if (busy) {
      startThinkingRotation();
    } else {
      stopThinkingRotation();
      statusEl.textContent = isWebMode ? '' : 'enter to send, shift+enter for newline';
    }
    statusEl.className = busy ? 'input-hint status-indicator active' : 'input-hint status-indicator';
  }
  if (input) {
    if (busy) {
      input.placeholder = 'Queue another message...';
    } else {
      input.disabled = false;
      const placeholders = [
        'What are you working on?',
        'Describe a task or ask a question...',
        'What needs fixing?',
        'What can I help you build?',
        'Drop a task, question, or idea...',
        'What\'s next?',
      ];
      input.placeholder = placeholders[Math.floor(Math.random() * placeholders.length)];
    }
  }
}

const thinkingPhrases = [
  'thinking...',
  'on it...',
  'working...',
  'cooking...',
  'brewing something...',
  'crunching...',
  'spinning up neurons...',
  'consulting the oracle...',
  'it\'s not a bug, it\'s an undocumented feature...',
  'have you tried turning it off and on again?',
  'reading the docs so you don\'t have to...',
  'git push --force-with-lease...',
  'rm -rf node_modules && npm install...',
  'blaming the intern...',
  'asking Stack Overflow...',
];
let thinkingInterval: any = null;
let lastThinkingIndex = -1;

function pickThinkingPhrase(): string {
  let idx = Math.floor(Math.random() * thinkingPhrases.length);
  while (idx === lastThinkingIndex && thinkingPhrases.length > 1) {
    idx = Math.floor(Math.random() * thinkingPhrases.length);
  }
  lastThinkingIndex = idx;
  return thinkingPhrases[idx];
}

function startThinkingRotation() {
  stopThinkingRotation();
  if (statusEl) statusEl.textContent = pickThinkingPhrase();
  thinkingInterval = setInterval(() => {
    if (statusEl) statusEl.textContent = pickThinkingPhrase();
  }, 3000);
}

function stopThinkingRotation() {
  if (thinkingInterval) {
    clearInterval(thinkingInterval);
    thinkingInterval = null;
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
    rewriteImageSources(bodyEl);
    applyDiffHighlighting(bodyEl);
    if (currentStreamingMessage.isStreaming) {
      bodyEl.classList.add('streaming-cursor');
    }
  }

  if (isUserScrolledUp) {
    setDirtyWhileScrolledUp(true);
    showScrollToBottomPill();
  } else {
    scrollToBottom();
  }
}

function renderAll(autoScrollForce: boolean = false, isUserInteraction: boolean = false) {
  if (!log) return;

  setIsRendering(true);

  const { wasAtBottom } = getScrollMetrics();

  if (autoScrollForce) {
    resetScrollState();
  }

  if (messages.length === 0) {
    renderEmptyState();
    setIsRendering(false);
    return;
  }

  log.innerHTML = '';

  const isPlanBeingCreated = !!(currentStreamingMessage && (currentStreamingMessage as any).isPlanMode);
  const hasPendingPlan = messages.some(m => m.plan && !(m.plan as any).cancelled && !(m.plan as any).isApproved &&
                           m.plan.steps.filter((s: any) => s.completed).length === 0);
  const isPlanExecuting = messages.some(m => m.plan && !(m.plan as any).cancelled && (m.plan as any).isApproved &&
                           m.plan.steps.filter((s: any) => s.completed).length < m.plan.steps.length);

  if (input) {
    if (isPlanBeingCreated) {
      input.disabled = true;
      input.placeholder = 'Wait while I create the plan...';
    } else if (hasPendingPlan) {
      input.disabled = true;
      input.placeholder = 'Review the plan above to approve, modify, or reject';
    } else if (isPlanExecuting) {
      input.disabled = false;
      input.placeholder = 'Steer the plan execution...';
    } else if (!isBusyState) {
      input.disabled = false;
    }
  }

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
    role.textContent = msg.role === 'user' ? 'you' : botDisplayName;
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
          (autoScroll, isUser) => renderAll(autoScroll, isUser),
          isWebMode
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
  rewriteImageSources(log);
  renderMermaidDiagrams(log);

  requestAnimationFrame(() => {
    if (autoScrollForce || wasAtBottom) {
      scrollToBottom();
    } else if (isUserScrolledUp && !isUserInteraction) {
      showScrollToBottomPill();
    }
    setIsRendering(false);
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

    if (data.isWebMode) {
      isWebMode = true;
    }

    if (data.botName) {
      botDisplayName = data.botName;
      const emptyTitle = document.querySelector('.empty-state-title');
      if (emptyTitle) emptyTitle.textContent = data.botName;
      document.querySelectorAll('.msg-role.assistant').forEach(el => {
        el.textContent = data.botName;
      });
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
      if (isUserScrolledUp) setDirtyWhileScrolledUp(true);
      if (currentStreamingMessage) {
        currentStreamingMessage.text += data.delta;
        updateStreamingDOM();
      }
      break;

    case 'thinkingDelta':
      if (isUserScrolledUp) setDirtyWhileScrolledUp(true);
      if (currentStreamingMessage) {
        currentStreamingMessage.thinking = (currentStreamingMessage.thinking || '') + data.delta;
        updateStreamingDOM();
      }
      break;

    case 'toolCall': {
      if (isUserScrolledUp) setDirtyWhileScrolledUp(true);
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
        processToolCallForTasks(data.name, data.args, data.result, data.status);
        renderAll();
      }
      break;
    }

    case 'stepComplete':
      if (currentStreamingMessage && data.usage) {
        currentStreamingMessage.tokens = data.usage;
        saveSessionUsage(data.conversationId, activeConversationId, data.usage, currentStreamingMessage.id);
        renderAll();
      }
      break;

    case 'result':
      setBusy(false);
      if (currentStreamingMessage) {
        if (!currentStreamingMessage.text && data.response && data.response.trim().length > 0) {
          currentStreamingMessage.text = data.response;
        }
        if (data.status === 'ERROR' || data.status === 'FAILURE') {
          if (!currentStreamingMessage.text &&
              (!currentStreamingMessage.thinking || !currentStreamingMessage.thinking.trim()) &&
              (!currentStreamingMessage.toolCalls || currentStreamingMessage.toolCalls.length === 0)) {
            const errDetail = data.error ? `: ${data.error}` : '';
            currentStreamingMessage.text = `[Response failed${errDetail}] - try sending again`;
          }
        }
        if (data.usage) {
          currentStreamingMessage.tokens = data.usage;
          saveSessionUsage(data.conversationId, activeConversationId, data.usage, currentStreamingMessage.id);
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
        setAtFilteredFiles(data.files || []);
      } else {
        hideAtMenu();
      }
      break;
    }

    case 'planConfirm': {
      const bar = document.getElementById('plan-confirm-bar');
      if (bar) bar.style.display = 'flex';
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

    case 'resourceMappings':
      resourceMappings = data.mappings || [];
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
        setSlashCommands(data.commands);
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
        if (data.workspaceInfo.name) setWorkspaceKey(data.workspaceInfo.name);
      }
      renderHistoryDropdown(data.sessions, data.currentId);
      break;

    case 'sessionLoaded': {
      activeConversationId = data.conversationId;
      messages = [];
      currentStreamingMessage = null;

      if (data.workspaceInfo) {
        updateWorkspaceHeaderBadge(data.workspaceInfo);
        if (data.workspaceInfo.name) setWorkspaceKey(data.workspaceInfo.name);
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




if (messages.length > 0) {
  renderAll();
}


vscode.postMessage({ command: 'ready' });

