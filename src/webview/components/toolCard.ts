import { ToolCall } from '../types';
import { esc } from '../utils/escape';
import { toPascalCaseName, formatToolSummary, formatToolArgsForDisplay } from '../utils/formatters';
import { buildDiffFromToolArgs, extractTargetFile, extractStringResult, renderDiffOrTextHtml } from '../utils/diffBuilder';

export function renderToolCallCard(
  tc: ToolCall,
  postMessage: (msg: any) => void,
  renderAll: (autoScrollForce?: boolean, isUserInteraction?: boolean) => void
): HTMLElement {
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
  hintEl.textContent = tc.expanded ? '▼' : '▶';

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
        postMessage({
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

  if (!diffStr && tc.args && (typeof tc.args === 'string' || (typeof tc.args === 'object' && Object.keys(tc.args).length > 0))) {
    hasContent = true;
    const argsBlock = document.createElement('div');
    argsBlock.className = 'tool-args-block';
    const title = document.createElement('div');
    title.className = 'tool-block-title';
    title.textContent = 'Arguments';
    argsBlock.appendChild(title);

    const formatted = formatToolArgsForDisplay(tc.name, tc.args);
    const pre = document.createElement('pre');
    pre.className = 'tool-json-pre';
    pre.textContent = formatted;
    argsBlock.appendChild(pre);
    bodyInner.appendChild(argsBlock);
  }

  const resultText = extractStringResult(tc.result);
  if (!diffStr && resultText && resultText.trim()) {
    hasContent = true;
    const resBlock = document.createElement('div');
    resBlock.className = 'tool-result-block';
    const title = document.createElement('div');
    title.className = 'tool-block-title';
    title.textContent = tc.status === 'error' ? 'Error' : 'Output';
    resBlock.appendChild(title);

    const pre = document.createElement('pre');
    pre.className = 'tool-json-pre';
    pre.innerHTML = renderDiffOrTextHtml(resultText);
    resBlock.appendChild(pre);
    bodyInner.appendChild(resBlock);
  }

  if (hasContent) {
    header.style.cursor = 'pointer';
    header.onclick = (e) => {
      const target = e.target as HTMLElement;
      if (target && target.classList.contains('clickable-file')) {
        return;
      }
      tc.expanded = !tc.expanded;
      renderAll(false, true);
    };
  } else {
    hintEl.style.display = 'none';
  }

  body.appendChild(bodyInner);
  accordion.appendChild(header);
  accordion.appendChild(body);

  return accordion;
}
