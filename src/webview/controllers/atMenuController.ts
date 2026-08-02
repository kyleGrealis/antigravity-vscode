import { esc } from '../utils/escape';

let atMenuIndex = 0;
let atFilteredFiles: string[] = [];
let atDebounceTimer: any = null;

let inputRef: HTMLTextAreaElement;
let atMenuRef: HTMLElement;
let postMessageRef: (msg: any) => void;

export function initAtMenu(
  input: HTMLTextAreaElement,
  atMenu: HTMLElement,
  postMessage: (msg: any) => void
) {
  inputRef = input;
  atMenuRef = atMenu;
  postMessageRef = postMessage;
}

export function setAtFilteredFiles(files: string[]) {
  atFilteredFiles = files;
  atMenuIndex = 0;
  renderAtMenu();
}

export function getAtMatch(): { start: number; end: number; query: string } | null {
  if (!inputRef) return null;
  const cursor = inputRef.selectionStart;
  const textBeforeCursor = inputRef.value.slice(0, cursor);
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

export function isAtMenuVisible(): boolean {
  return atMenuRef?.style.display !== 'none' && atFilteredFiles.length > 0;
}

export function updateAtMenu() {
  const match = getAtMatch();
  if (!match) {
    hideAtMenu();
    return;
  }
  if (atDebounceTimer) clearTimeout(atDebounceTimer);
  atDebounceTimer = setTimeout(() => {
    postMessageRef({ command: 'searchFiles', query: match.query });
  }, 100);
}

export function hideAtMenu() {
  if (atMenuRef) atMenuRef.style.display = 'none';
  atFilteredFiles = [];
}

export function renderAtMenu() {
  if (!atMenuRef) return;
  atMenuRef.innerHTML = '';
  if (atFilteredFiles.length === 0) {
    atMenuRef.style.display = 'none';
    return;
  }

  atFilteredFiles.forEach((file, i) => {
    const row = document.createElement('div');
    row.className = 'at-item' + (i === atMenuIndex ? ' active' : '');
    row.innerHTML = `<span class="at-icon">@</span><span class="at-path">${esc(file)}</span>`;
    row.addEventListener('mouseenter', () => {
      atMenuIndex = i;
      const items = atMenuRef.querySelectorAll('.at-item');
      items.forEach((el, idx) => {
        el.classList.toggle('active', idx === atMenuIndex);
      });
    });
    row.addEventListener('mousedown', (e) => {
      e.preventDefault();
      atMenuIndex = i;
      acceptAtItem();
    });
    atMenuRef.appendChild(row);
  });
  atMenuRef.style.display = 'block';

  const activeEl = atMenuRef.querySelector('.at-item.active') as HTMLElement;
  if (activeEl) {
    activeEl.scrollIntoView({ block: 'nearest' });
  }
}

export function acceptAtItem() {
  const file = atFilteredFiles[atMenuIndex];
  if (!file) return;
  const match = getAtMatch();
  if (!match) return;

  const before = inputRef.value.slice(0, match.start);
  const after = inputRef.value.slice(match.end);
  const replacement = `@${file} `;
  inputRef.value = before + replacement + after;
  const newCursorPos = before.length + replacement.length;
  inputRef.setSelectionRange(newCursorPos, newCursorPos);

  hideAtMenu();
  inputRef.focus();
}

export function navigateAtMenu(direction: 'up' | 'down') {
  if (!isAtMenuVisible()) return;
  if (direction === 'up') {
    atMenuIndex = atMenuIndex <= 0 ? atFilteredFiles.length - 1 : atMenuIndex - 1;
  } else {
    atMenuIndex = atMenuIndex >= atFilteredFiles.length - 1 ? 0 : atMenuIndex + 1;
  }
  renderAtMenu();
}
