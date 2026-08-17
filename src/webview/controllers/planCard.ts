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
    approveBtn.textContent = 'Approve & Proceed';
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

export interface ClarificationQuestionItem {
  question: string;
  options?: string[];
  isMultiSelect?: boolean;
  is_multi_select?: boolean;
}

export function renderClarificationCard(q: any): HTMLElement {
  const card = document.createElement('div');
  card.className = 'clarification-card';

  // Normalize questions array
  let rawQuestions: ClarificationQuestionItem[] = [];
  if (typeof q === 'string') {
    try {
      q = JSON.parse(q);
    } catch {}
  }
  if (Array.isArray(q)) {
    rawQuestions = q;
  } else if (q && Array.isArray(q.questions)) {
    rawQuestions = q.questions;
  } else if (q && typeof q.questions === 'string') {
    try {
      const parsedQ = JSON.parse(q.questions);
      if (Array.isArray(parsedQ)) rawQuestions = parsedQ;
      else if (parsedQ && typeof parsedQ === 'object') rawQuestions = [parsedQ];
    } catch {}
  } else if (q && (q.question || q.title)) {
    rawQuestions = [{
      question: q.question || q.title || 'Clarification Question',
      options: q.options || [],
      isMultiSelect: q.isMultiSelect ?? q.is_multi_select ?? false,
    }];
  }

  if (rawQuestions.length === 0) {
    card.style.display = 'none';
    return card;
  }

  const isAlreadySubmitted = !!q._isSubmitted;
  if (isAlreadySubmitted) {
    card.classList.add('submitted');
  }

  const header = document.createElement('div');
  header.className = 'clarification-header';
  header.innerHTML = `<span class="clarification-badge">Clarification</span><span class="clarification-title">${rawQuestions.length === 1 ? esc(rawQuestions[0].question) : 'Please answer the following questions to proceed:'}</span>`;
  card.appendChild(header);

  const cardUid = `clarif_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const questionBlocks: Array<{
    item: ClarificationQuestionItem;
    container: HTMLElement;
    getSelection: () => { answers: string[]; custom: string };
  }> = [];

  rawQuestions.forEach((item, idx) => {
    const block = document.createElement('div');
    block.className = 'clarification-q-block';

    if (rawQuestions.length > 1) {
      const qTitle = document.createElement('div');
      qTitle.className = 'clarification-q-title';
      qTitle.innerHTML = `<span class="clarification-q-num">${idx + 1}.</span> ${esc(item.question)}`;
      block.appendChild(qTitle);
    }

    const optionsContainer = document.createElement('div');
    optionsContainer.className = 'clarification-options';

    const isMulti = !!(item.isMultiSelect ?? item.is_multi_select);
    const inputType = isMulti ? 'checkbox' : 'radio';
    const groupName = `${cardUid}_q${idx}`;

    if (item.options && item.options.length > 0) {
      item.options.forEach((optText, optIdx) => {
        const label = document.createElement('label');
        label.className = 'clarification-option-label';

        const optInput = document.createElement('input');
        optInput.type = inputType;
        optInput.name = groupName;
        optInput.value = optText;
        if (isAlreadySubmitted && Array.isArray(q._submittedAnswers?.[idx]) && q._submittedAnswers[idx].includes(optText)) {
          optInput.checked = true;
        }
        if (isAlreadySubmitted) {
          optInput.disabled = true;
        }

        const txt = document.createElement('span');
        txt.textContent = optText;

        label.appendChild(optInput);
        label.appendChild(txt);
        optionsContainer.appendChild(label);
      });
    }

    block.appendChild(optionsContainer);

    const customInput = document.createElement('input');
    customInput.type = 'text';
    customInput.className = 'clarification-input';
    customInput.placeholder = 'Or type custom guidance / additional notes...';
    if (isAlreadySubmitted && q._submittedCustom?.[idx]) {
      customInput.value = q._submittedCustom[idx];
      customInput.disabled = true;
    } else if (isAlreadySubmitted) {
      customInput.disabled = true;
    }
    block.appendChild(customInput);

    questionBlocks.push({
      item,
      container: block,
      getSelection: () => {
        const checked = optionsContainer.querySelectorAll('input:checked');
        const answers: string[] = [];
        checked.forEach((el: any) => answers.push(el.value));
        const custom = customInput.value.trim();
        return { answers, custom };
      },
    });

    card.appendChild(block);
  });

  const actions = document.createElement('div');
  actions.className = 'plan-actions';

  const submitBtn = document.createElement('button');
  submitBtn.className = 'plan-btn plan-btn-primary';
  submitBtn.textContent = isAlreadySubmitted ? 'Responses Submitted' : 'Submit Responses';
  if (isAlreadySubmitted) {
    submitBtn.disabled = true;
  }

  submitBtn.onclick = (e) => {
    e.stopPropagation();
    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting...';

    const recordedAnswers: string[][] = [];
    const recordedCustom: string[] = [];
    const responseLines: string[] = [];

    questionBlocks.forEach((qb, idx) => {
      const sel = qb.getSelection();
      recordedAnswers.push(sel.answers);
      recordedCustom.push(sel.custom);

      let line = '';
      if (rawQuestions.length > 1) {
        line += `${idx + 1}. ${qb.item.question}\n   `;
      }
      const parts: string[] = [];
      if (sel.answers.length > 0) {
        parts.push(sel.answers.join(' | '));
      }
      if (sel.custom) {
        parts.push(`Custom: ${sel.custom}`);
      }
      line += parts.length > 0 ? parts.join(' -- ') : 'Proceed with default recommendation.';
      responseLines.push(line);
    });

    q._isSubmitted = true;
    q._submittedAnswers = recordedAnswers;
    q._submittedCustom = recordedCustom;
    card.classList.add('submitted');

    const promptText = responseLines.join('\n');
    const inp = callbacks.getInput();
    if (inp) {
      inp.value = promptText;
      callbacks.sendPrompt();
    }
  };

  actions.appendChild(submitBtn);
  card.appendChild(actions);

  return card;
}
