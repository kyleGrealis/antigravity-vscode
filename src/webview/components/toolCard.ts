import { ToolCall } from '../types';
import { esc } from '../utils/escape';
import { toPascalCaseName, formatToolSummary, formatToolArgsForDisplay, parseJsonArgs, getArgVal } from '../utils/formatters';
import { buildDiffFromToolArgs, extractTargetFile, extractStringResult, renderDiffOrTextHtml } from '../utils/diffBuilder';
import { getTaskStatus } from '../controllers/taskTracker';

export function renderToolCallCard(
  tc: ToolCall,
  postMessage: (msg: any) => void,
  renderAll: (autoScrollForce?: boolean, isUserInteraction?: boolean) => void,
  webMode = false
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
    if (summary.isFile && !webMode) {
      summaryEl.innerHTML = `(<span class="clickable-file" data-path="${esc(argsText)}" title="Click to open in editor">${esc(argsText)}</span>)`;
    } else if (summary.isFile) {
      summaryEl.textContent = `(${argsText})`;
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

  const isTaskTool = ['manage_task', 'managetask', 'invoke_subagent', 'invokesubagent'].includes((tc.name || '').toLowerCase().replace(/[^a-z_]/g, ''));
  if (isTaskTool && statusClass === 'running') {
    const taskMeta = document.createElement('span');
    taskMeta.className = 'task-running-meta';

    const elapsed = document.createElement('span');
    elapsed.className = 'task-elapsed';
    const startTime = Date.now();
    elapsed.textContent = '0s';
    const timer = setInterval(() => {
      const secs = Math.floor((Date.now() - startTime) / 1000);
      elapsed.textContent = secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m ${secs % 60}s`;
      if (tc.status !== 'running') {
        clearInterval(timer);
        taskMeta.remove();
      }
    }, 1000);

    const killBtn = document.createElement('button');
    killBtn.className = 'task-kill-btn';
    killBtn.textContent = 'Kill';
    killBtn.title = 'Cancel this task';
    killBtn.onclick = (e) => {
      e.stopPropagation();
      const parsedArgs = parseJsonArgs(tc.args);
      const taskId = getArgVal(parsedArgs, 'TaskId', 'taskId', 'task_id');
      postMessage({ command: 'killTask', taskId: taskId });
    };

    taskMeta.appendChild(elapsed);
    taskMeta.appendChild(killBtn);
    header.appendChild(taskMeta);
  }

  const subagentTools = ['invoke_subagent', 'invokesubagent', 'define_subagent', 'definesubagent'];
  const isSubagentTool = subagentTools.includes((tc.name || '').toLowerCase().replace(/[^a-z_]/g, ''));
  if (isSubagentTool && statusClass === 'done') {
    const resultStr = typeof tc.result === 'string' ? tc.result : JSON.stringify(tc.result || '');
    const uuidMatch = resultStr.match(/\b([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/i);
    if (uuidMatch) {
      const subagentId = uuidMatch[1];
      const tracked = getTaskStatus(subagentId);
      if (tracked && tracked.status === 'running') {
        statusIcon.className = 'tool-status-icon running';
        statusIcon.innerHTML = '&#9696;';

        const subMeta = document.createElement('span');
        subMeta.className = 'task-running-meta';

        const badge = document.createElement('span');
        badge.className = 'subagent-badge';
        badge.textContent = 'subagent running';

        const elapsed = document.createElement('span');
        elapsed.className = 'task-elapsed';
        const start = tracked.startTime;
        const fmt = (ms: number) => {
          const s = Math.floor(ms / 1000);
          return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
        };
        elapsed.textContent = fmt(Date.now() - start);
        const timer = setInterval(() => {
          const t = getTaskStatus(subagentId);
          if (!t || t.status !== 'running') {
            clearInterval(timer);
            subMeta.remove();
            statusIcon.className = 'tool-status-icon done';
            statusIcon.innerHTML = '&#9679;';
            return;
          }
          elapsed.textContent = fmt(Date.now() - start);
        }, 1000);

        const killBtn = document.createElement('button');
        killBtn.className = 'task-kill-btn';
        killBtn.textContent = 'Kill';
        killBtn.title = 'Cancel this subagent';
        killBtn.onclick = (e) => {
          e.stopPropagation();
          postMessage({ command: 'killTask', taskId: subagentId });
        };

        subMeta.appendChild(badge);
        subMeta.appendChild(elapsed);
        subMeta.appendChild(killBtn);
        header.appendChild(subMeta);
      } else if (tracked && tracked.status !== 'running') {
        const doneBadge = document.createElement('span');
        doneBadge.className = `subagent-badge subagent-${tracked.status}`;
        doneBadge.textContent = `subagent ${tracked.status}`;
        header.appendChild(doneBadge);
      }
    }
  }

  header.appendChild(hintEl);

  const body = document.createElement('div');
  body.className = `tool-body${tc.expanded ? ' open' : ''}`;

  const bodyInner = document.createElement('div');
  bodyInner.className = 'tool-body-inner';

  let hasContent = false;

  const targetFile = extractTargetFile(tc.name, tc.args, tc.result);
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

    if (targetFile && !webMode) {
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

  const imageExts = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp'];
  const readTools = ['readfile', 'read_file', 'viewfile', 'view_file'];
  const tcNameLower = (tc.name || '').toLowerCase().replace(/[^a-z]/g, '');
  const isImageRead = readTools.some(t => t.replace(/[^a-z]/g, '') === tcNameLower) && targetFile && imageExts.some(ext => targetFile.toLowerCase().endsWith(ext));
  if (isImageRead && targetFile) {
    hasContent = true;
    const imgBlock = document.createElement('div');
    imgBlock.className = 'tool-image-preview';
    const img = document.createElement('img');
    img.src = targetFile;
    img.alt = targetFile.split(/[/\\]/).pop() || 'Image';
    img.className = 'tool-image-inline';
    if (!webMode) {
      img.onclick = (e) => {
        e.stopPropagation();
        postMessage({ command: 'openFile', filePath: targetFile });
      };
    }
    imgBlock.appendChild(img);
    bodyInner.appendChild(imgBlock);
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
