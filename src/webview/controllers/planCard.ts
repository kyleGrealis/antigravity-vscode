import { Message } from '../types';
import { esc } from '../utils/escape';

export interface PlanCallbacks {
  getMessages: () => Message[];
  pushMessage: (msg: Message) => void;
  setCurrentStreamingMessage: (msg: Message) => void;
  renderAll: (autoScroll?: boolean, isUserInteraction?: boolean) => void;
  setBusy: (busy: boolean) => void;
  postMessage: (msg: any) => void;
  getInput: () => HTMLTextAreaElement;
  sendPrompt: () => void;
}

let callbacks: PlanCallbacks;

export function initPlanCard(cb: PlanCallbacks) {
  callbacks = cb;
}

export function renderPlanCard(plan: { filePath: string; timestamp: string; title: string; steps: Array<{ id: string; text: string; completed: boolean }> }): HTMLElement {
  const isCancelled = !!(plan as any).cancelled;
  if (isCancelled) {
    const card = document.createElement('div');
    card.className = 'plan-card cancelled';
    card.innerHTML = `
      <div class="plan-header">
        <div class="plan-title-group">
          <span class="plan-badge cancelled">Plan Cancelled</span>
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
  badge.textContent = isCompleted ? 'Plan Complete' : 'Plan';
  titleGroup.appendChild(badge);

  const titleEl = document.createElement('span');
  titleEl.className = 'plan-title';
  titleEl.textContent = plan.title || 'Implementation Plan';
  titleGroup.appendChild(titleEl);

  header.appendChild(titleGroup);

  const openBtn = document.createElement('button');
  openBtn.className = 'plan-open-btn';
  openBtn.innerHTML = 'Open in Editor';
  openBtn.onclick = (e) => {
    e.stopPropagation();
    callbacks.postMessage({ command: 'openPlanFile', filePath: plan.filePath });
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
    approveBtn.textContent = 'Approve & Execute Plan';
    approveBtn.onclick = (e) => {
      e.stopPropagation();
      (plan as any).isApproved = true;
      actions.remove();

      const displayUserText = `Proceeding with implementation plan (${plan.title || 'Plan'}).`;
      const fullSystemPrompt = `[EXECUTE PLAN] Read the implementation plan at "${plan.filePath}" and immediately execute every task step-by-step using your file writing and command tools. As you complete each task, update the checklist in "${plan.filePath}" by marking '[x]'.`;

      const streamMsg: Message = {
        id: `a-${Date.now()}`,
        role: 'assistant',
        text: '',
        thinking: '',
        toolCalls: [],
        isStreaming: true,
      };
      callbacks.pushMessage({
        id: `u-${Date.now()}`,
        role: 'user',
        text: displayUserText,
      });
      callbacks.pushMessage(streamMsg);
      callbacks.setCurrentStreamingMessage(streamMsg);
      callbacks.renderAll(true);
      callbacks.setBusy(true);

      callbacks.postMessage({ command: 'userPrompt', promptText: fullSystemPrompt, images: [] });
    };
    actions.appendChild(approveBtn);

    const modifyBtn = document.createElement('button');
    modifyBtn.className = 'plan-btn plan-btn-secondary';
    modifyBtn.textContent = 'Modify Plan';
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
      submitBtn.textContent = 'Submit Edits';

      const cancelFormBtn = document.createElement('button');
      cancelFormBtn.className = 'plan-btn plan-btn-secondary';
      cancelFormBtn.textContent = 'Cancel';

      const submitEdit = () => {
        const rawText = modifyInput.value.trim();
        if (!rawText) return;
        modifyForm.remove();

        const text = rawText.startsWith('Edits to the plan:') ? rawText : `Edits to the plan: ${rawText}`;

        callbacks.pushMessage({
          id: `u-${Date.now()}`,
          role: 'user',
          text,
        });

        const streamMsg: Message = {
          id: `a-${Date.now()}`,
          role: 'assistant',
          text: 'Updating implementation plan...',
          thinking: '',
          isPlanMode: true,
          toolCalls: [],
          isStreaming: true,
        };
        callbacks.pushMessage(streamMsg);
        callbacks.setCurrentStreamingMessage(streamMsg);
        callbacks.renderAll(true);
        callbacks.setBusy(true);

        callbacks.postMessage({ command: 'userPrompt', promptText: text, images: [] });
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
    cancelPlanBtn.textContent = 'Cancel Plan';
    cancelPlanBtn.onclick = (e) => {
      e.stopPropagation();
      (plan as any).cancelled = true;
      actions.remove();
      const inputArea = document.querySelector('.input-area') as HTMLElement;
      if (inputArea) inputArea.style.display = '';
      callbacks.postMessage({ command: 'cancel' });
      callbacks.setBusy(false);
      callbacks.renderAll(false, true);
    };
    actions.appendChild(cancelPlanBtn);
    card.appendChild(actions);
  }

  if (isApproved && !isCompleted) {
    const execBar = document.createElement('div');
    execBar.className = 'plan-exec-bar';
    execBar.innerHTML = `<span class="plan-exec-status">Executing Plan Step-by-Step...</span>`;

    const cancelExecBtn = document.createElement('button');
    cancelExecBtn.className = 'plan-btn plan-btn-secondary plan-btn-cancel-exec';
    cancelExecBtn.textContent = 'Cancel Execution';
    cancelExecBtn.onclick = (e) => {
      e.stopPropagation();
      (plan as any).cancelled = true;
      callbacks.postMessage({ command: 'cancel' });
      callbacks.setBusy(false);
      callbacks.renderAll(false, true);
    };
    execBar.appendChild(cancelExecBtn);
    card.appendChild(execBar);
  }

  return card;
}

export function renderClarificationCard(q: { question: string; options?: string[]; isMultiSelect?: boolean }): HTMLElement {
  const card = document.createElement('div');
  card.className = 'clarification-card';

  const title = document.createElement('div');
  title.className = 'clarification-title';
  title.innerHTML = `<span>Clarification Required:</span> ${esc(q.question)}`;
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

    const inp = callbacks.getInput();
    if (inp) {
      inp.value = responseMsg;
      callbacks.sendPrompt();
    }
  };
  actions.appendChild(submitBtn);

  card.appendChild(actions);

  return card;
}
