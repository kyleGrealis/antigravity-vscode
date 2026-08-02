import { Message } from '../types';
import { esc } from '../utils/escape';

let copyFn: (text: string, btn?: HTMLButtonElement) => void;

export function initUsageTracker(copyTextToClipboard: (text: string, btn?: HTMLButtonElement) => void) {
  copyFn = copyTextToClipboard;
}

export function saveSessionUsage(convId: string | null, activeConversationId: string | null, usage: any, currentMsgId?: string) {
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

      const turnKey = currentMsgId || 'latest_turn';

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

export function showUsageOverlay(messages: Message[], activeConversationId: string | null) {
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

  const cacheBadge = totalCache > 0 ? `<div class="usage-cache-note">Cache read tokens: <strong>${fmt(totalCache)}</strong></div>` : '';

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
