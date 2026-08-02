import { esc } from '../utils/escape';

export interface SessionEntry {
  id: string;
  title: string;
  updatedAt: number;
  relativeTime: string;
  workspacePath?: string;
  workspaceName?: string;
  workspaceMatch?: boolean;
}

let historyDropdown: HTMLElement;
let postMessage: (msg: any) => void;
let cachedSessionsList: SessionEntry[] = [];

export function initSessionHistory(
  dropdownEl: HTMLElement,
  sendMessage: (msg: any) => void,
) {
  historyDropdown = dropdownEl;
  postMessage = sendMessage;
}

export function updateWorkspaceHeaderBadge(info?: { name: string; path: string } | null) {
  const badge = document.getElementById('header-workspace-badge');
  if (!badge) return;
  if (info && info.name) {
    badge.textContent = info.name;
    badge.title = `Workspace: ${info.path}`;
    badge.style.display = 'inline-flex';
  } else {
    badge.style.display = 'none';
  }
}

export function renderHistoryDropdown(sessions: SessionEntry[], currentId?: string | null) {
  if (!historyDropdown) return;
  cachedSessionsList = sessions || [];
  renderFilteredSessions(cachedSessionsList, currentId, '');
}

function renderFilteredSessions(sessions: SessionEntry[], currentId?: string | null, searchQuery = '') {
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
      <input type="text" id="history-search-input" placeholder="Search sessions..." value="${esc(searchQuery)}" autocomplete="off" />
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
            <div class="history-item-title" title="${esc(s.title)}">${esc(s.title)}</div>
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
        postMessage({ command: 'selectSession', conversationId: convId });
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
          postMessage({ command: 'renameSession', conversationId: convId, title: newTitle });
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
