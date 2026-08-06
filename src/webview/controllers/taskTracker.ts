interface TrackedTask {
  taskId: string;
  description: string;
  status: 'running' | 'done' | 'cancelled' | 'error';
  startTime: number;
}

const activeTasks = new Map<string, TrackedTask>();
let trackerEl: HTMLElement | null = null;
let postMessageFn: ((msg: any) => void) | null = null;
let timerId: ReturnType<typeof setInterval> | null = null;

export function initTaskTracker(
  container: HTMLElement,
  postMessage: (msg: any) => void
) {
  trackerEl = container;
  postMessageFn = postMessage;
}

export function processToolCallForTasks(name: string, args: any, result: string | undefined, status: string | undefined) {
  const normName = (name || '').toLowerCase().replace(/[^a-z_]/g, '');

  if (normName === 'runcommand' || normName === 'run_command') {
    detectTaskLaunch(result);
  }

  if (normName === 'invokesubagent' || normName === 'invoke_subagent' ||
      normName === 'definesubagent' || normName === 'define_subagent') {
    detectTaskLaunch(result);
    const parsedArgs = typeof args === 'object' ? args : tryParse(args);
    const taskName = parsedArgs?.Name || parsedArgs?.name || parsedArgs?.TaskName || parsedArgs?.task_name || '';
    if (result && status === 'done') {
      const uuid = extractUuidTaskId(result) || extractUuidTaskId(JSON.stringify(parsedArgs));
      if (uuid && !activeTasks.has(uuid)) {
        activeTasks.set(uuid, {
          taskId: uuid,
          description: taskName || uuid.substring(0, 8),
          status: 'running',
          startTime: Date.now(),
        });
        renderTracker();
      }
    }
  }

  if (normName === 'managetask' || normName === 'manage_task' ||
      normName === 'managesubagents' || normName === 'manage_subagents') {
    const parsedArgs = typeof args === 'object' ? args : tryParse(args);
    const action = (parsedArgs?.Action || parsedArgs?.action || '').toLowerCase();

    if (action === 'status' && result) {
      detectTaskStatus(result, parsedArgs);
    }

    if ((action === 'kill' || action === 'cancel') && status === 'done') {
      const taskId = parsedArgs?.TaskId || parsedArgs?.taskId || parsedArgs?.task_id;
      const convIds = parsedArgs?.ConversationIds || parsedArgs?.conversationIds || parsedArgs?.conversation_ids || [];
      const allIds: string[] = [];
      if (taskId) allIds.push(taskId);
      if (Array.isArray(convIds)) allIds.push(...convIds);

      let changed = false;
      for (const id of allIds) {
        const resolved = extractShortTaskId(id) || extractUuidTaskId(id) || id;
        if (activeTasks.has(resolved)) {
          activeTasks.get(resolved)!.status = 'cancelled';
          changed = true;
        }
      }
      if (changed) renderTracker();
    }
  }
}

function detectTaskLaunch(result: string | undefined) {
  if (!result) return;
  let found = false;

  const shortMatches = result.matchAll(/\b(task-\d+)\b/gi);
  for (const m of shortMatches) {
    const taskId = m[1];
    if (!activeTasks.has(taskId)) {
      activeTasks.set(taskId, {
        taskId,
        description: taskId,
        status: 'running',
        startTime: Date.now(),
      });
      found = true;
    }
  }

  const uuidContextPattern = /(?:task|subagent|conversation|agent)[\s_:-]*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/gi;
  for (const m of result.matchAll(uuidContextPattern)) {
    const uuid = m[1];
    if (!activeTasks.has(uuid)) {
      activeTasks.set(uuid, {
        taskId: uuid,
        description: uuid.substring(0, 8),
        status: 'running',
        startTime: Date.now(),
      });
      found = true;
    }
  }

  if (found) renderTracker();
}

function detectTaskStatus(result: string, args: any) {
  const taskId = args?.TaskId || args?.taskId || args?.task_id || '';
  const shortId = extractShortTaskId(taskId) || extractTaskIdFromResult(result);
  if (!shortId) return;

  const statusMatch = result.match(/Status:\s*(RUNNING|DONE|CANCELLED|ERROR|FAILED|COMPLETED)/i);
  if (!statusMatch) return;

  const newStatus = statusMatch[1].toUpperCase();

  if (newStatus === 'RUNNING') {
    if (!activeTasks.has(shortId)) {
      activeTasks.set(shortId, {
        taskId: shortId,
        description: shortId,
        status: 'running',
        startTime: Date.now(),
      });
    }
  } else {
    const task = activeTasks.get(shortId);
    if (task) {
      task.status = newStatus === 'DONE' || newStatus === 'COMPLETED' ? 'done'
        : newStatus === 'CANCELLED' ? 'cancelled' : 'error';
    }
  }
  renderTracker();
}

function extractShortTaskId(fullId: string): string | null {
  if (!fullId) return null;
  const match = fullId.match(/(task-\d+)/);
  return match ? match[1] : null;
}

function extractUuidTaskId(text: string): string | null {
  if (!text) return null;
  const match = text.match(/\b([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/i);
  return match ? match[1] : null;
}

function extractTaskIdFromResult(result: string): string | null {
  const match = result.match(/(?:Task|task):\s*\S*(task-\d+)/);
  return match ? match[1] : null;
}

function tryParse(val: any): any {
  if (!val) return {};
  if (typeof val === 'object') return val;
  try { return JSON.parse(val); } catch { return {}; }
}

function formatElapsed(ms: number): string {
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  return `${Math.floor(secs / 60)}m ${secs % 60}s`;
}

function renderTracker() {
  if (!trackerEl) return;

  const running = [...activeTasks.values()].filter(t => t.status === 'running');

  if (running.length === 0) {
    trackerEl.style.display = 'none';
    if (timerId) {
      clearInterval(timerId);
      timerId = null;
    }
    return;
  }

  trackerEl.style.display = 'flex';
  trackerEl.innerHTML = '';

  const label = document.createElement('span');
  label.className = 'task-tracker-label';
  label.textContent = `${running.length} task${running.length > 1 ? 's' : ''} running`;
  trackerEl.appendChild(label);

  const list = document.createElement('div');
  list.className = 'task-tracker-list';

  for (const task of running) {
    const row = document.createElement('div');
    row.className = 'task-tracker-row';

    const id = document.createElement('span');
    id.className = 'task-tracker-id';
    id.textContent = task.taskId;

    const elapsed = document.createElement('span');
    elapsed.className = 'task-tracker-elapsed';
    elapsed.textContent = formatElapsed(Date.now() - task.startTime);

    const killBtn = document.createElement('button');
    killBtn.className = 'task-kill-btn';
    killBtn.textContent = 'Kill';
    killBtn.onclick = (e) => {
      e.stopPropagation();
      if (postMessageFn) {
        postMessageFn({ command: 'killTask', taskId: task.taskId });
      }
    };

    row.appendChild(id);
    row.appendChild(elapsed);
    row.appendChild(killBtn);
    list.appendChild(row);
  }

  trackerEl.appendChild(list);

  if (!timerId) {
    timerId = setInterval(() => {
      const stillRunning = [...activeTasks.values()].filter(t => t.status === 'running');
      if (stillRunning.length === 0) {
        renderTracker();
        return;
      }
      const elapsedEls = trackerEl?.querySelectorAll('.task-tracker-elapsed');
      elapsedEls?.forEach((el, i) => {
        if (stillRunning[i]) {
          el.textContent = formatElapsed(Date.now() - stillRunning[i].startTime);
        }
      });
    }, 1000);
  }
}

export function getTaskStatus(taskId: string): TrackedTask | null {
  return activeTasks.get(taskId) || null;
}

export function getRunningTaskIds(): string[] {
  return [...activeTasks.values()]
    .filter(t => t.status === 'running')
    .map(t => t.taskId);
}

export function clearTaskTracker() {
  activeTasks.clear();
  renderTracker();
}
