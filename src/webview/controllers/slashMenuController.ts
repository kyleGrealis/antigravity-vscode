import { SlashCommand, SlashDisplayItem } from '../types';
import { esc } from '../utils/escape';

let input: HTMLTextAreaElement;
let slashMenu: HTMLElement;
let slashMenuIndex = 0;
let slashFiltered: SlashDisplayItem[] = [];
let slashTriggerPos = -1;

let SLASH_COMMANDS: SlashCommand[] = [
  { name: 'effort', description: 'set reasoning effort (low, medium, high)', hasArg: true },
  { name: 'sandbox', description: 'toggle sandboxing (on|off)', hasArg: true },
  { name: 'dangerous', description: 'toggle permission auto-approvals (on|off)', hasArg: true },
  { name: 'plan', description: 'trigger plan mode with optional description', hasArg: true },
  { name: 'usage', description: 'show session token usage statistics overlay' },
  { name: 'new', description: 'start a new conversation' },
  { name: 'clear', description: 'clear chat history' },
  { name: 'settings', description: 'open extension settings' },
  { name: 'help', description: 'show available commands' },
];

export function initSlashMenu(inputEl: HTMLTextAreaElement, menuEl: HTMLElement) {
  input = inputEl;
  slashMenu = menuEl;
}

export function setSlashCommands(commands: SlashCommand[]) {
  SLASH_COMMANDS = commands;
}

export function isSlashMenuVisible(): boolean {
  return slashMenu?.style.display !== 'none' && slashFiltered.length > 0;
}

export function updateSlashMenu() {
  const val = input.value;
  const cursor = input.selectionStart ?? val.length;

  let slashPos = -1;
  for (let i = cursor - 1; i >= 0; i--) {
    if (val[i] === '/') {
      if (i === 0 || /\s/.test(val[i - 1])) {
        slashPos = i;
      }
      break;
    }
    if (/\s/.test(val[i])) break;
  }

  if (slashPos === -1) {
    hideSlashMenu();
    return;
  }

  const afterSlash = val.slice(slashPos + 1, cursor);

  if (afterSlash.includes(' ')) {
    const spaceIdx = afterSlash.indexOf(' ');
    const cmdName = afterSlash.slice(0, spaceIdx).toLowerCase();
    const argQuery = afterSlash.slice(spaceIdx + 1).toLowerCase();
    const cmd = SLASH_COMMANDS.find(c => c.name === cmdName);
    if (cmd && cmd.options) {
      const matchingOpts = cmd.options.filter(o => o.value.toLowerCase().includes(argQuery) || o.label.toLowerCase().includes(argQuery));
      if (matchingOpts.length > 0) {
        slashTriggerPos = slashPos;
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

  const q = afterSlash.toLowerCase();
  const matchedCmds = SLASH_COMMANDS.filter(c => c.name.startsWith(q));
  if (matchedCmds.length === 0) {
    hideSlashMenu();
    return;
  }

  slashTriggerPos = slashPos;
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

export function acceptSlashItem() {
  const item = slashFiltered[slashMenuIndex];
  if (!item) return;
  const val = input.value;
  const cursor = input.selectionStart ?? val.length;
  const insertText = item.insertValue
    ? item.insertValue + (item.insertValue.endsWith(' ') ? '' : ' ')
    : `/${item.name} `;

  if (slashTriggerPos >= 0) {
    const before = val.slice(0, slashTriggerPos);
    const after = val.slice(cursor);
    input.value = before + insertText + after;
    const newCursor = before.length + insertText.length;
    input.setSelectionRange(newCursor, newCursor);
  } else {
    input.value = insertText;
    input.setSelectionRange(insertText.length, insertText.length);
  }
  hideSlashMenu();
  input.focus();
}

export function hideSlashMenu() {
  if (slashMenu) slashMenu.style.display = 'none';
  slashFiltered = [];
  slashTriggerPos = -1;
}

export function navigateSlashMenu(direction: 'up' | 'down') {
  if (direction === 'down') {
    slashMenuIndex = (slashMenuIndex + 1) % slashFiltered.length;
  } else {
    slashMenuIndex = (slashMenuIndex - 1 + slashFiltered.length) % slashFiltered.length;
  }
  renderSlashMenu();
}

export function getSlashCommands(): SlashCommand[] {
  return SLASH_COMMANDS;
}
