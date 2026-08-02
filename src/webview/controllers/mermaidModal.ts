import mermaid from 'mermaid';

let mermaidInitialized = false;
let mermaidCounter = 0;
let modalOverlay: HTMLElement | null = null;
let currentZoom = 1;
let currentPanX = 0;
let currentPanY = 0;
let copyFn: (text: string, btn?: HTMLButtonElement) => void;

export function initMermaidController(copyTextToClipboard: (text: string, btn?: HTMLButtonElement) => void) {
  copyFn = copyTextToClipboard;
}

function initMermaid() {
  if (mermaidInitialized) return;
  const isDark = !document.body.classList.contains('vscode-light');
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'loose',
    theme: isDark ? 'dark' : 'default',
    fontFamily: 'var(--font-mono, Consolas, monospace)',
  });
  mermaidInitialized = true;
}

export async function renderMermaidDiagrams(container: HTMLElement) {
  const mermaidBlocks = container.querySelectorAll<HTMLElement>('pre code.language-mermaid, pre code.lang-mermaid');
  if (mermaidBlocks.length === 0) return;

  initMermaid();

  for (const codeEl of Array.from(mermaidBlocks)) {
    const pre = codeEl.closest('pre');
    if (!pre || pre.dataset.mermaidProcessed === 'true') continue;
    pre.dataset.mermaidProcessed = 'true';

    const mermaidCode = codeEl.textContent || '';
    if (!mermaidCode.trim()) continue;

    const card = document.createElement('div');
    card.className = 'mermaid-card';

    const header = document.createElement('div');
    header.className = 'mermaid-header';

    const titleEl = document.createElement('div');
    titleEl.className = 'mermaid-title';
    titleEl.innerHTML = `<span class="mermaid-icon">📊</span><span>Mermaid Diagram</span>`;

    const actions = document.createElement('div');
    actions.className = 'mermaid-actions';

    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'mermaid-btn';
    toggleBtn.textContent = 'Code';
    toggleBtn.title = 'Toggle Code/Diagram';

    const copySvgBtn = document.createElement('button');
    copySvgBtn.className = 'mermaid-btn';
    copySvgBtn.textContent = 'Copy SVG';
    copySvgBtn.title = 'Copy SVG Image';

    const copyCodeBtn = document.createElement('button');
    copyCodeBtn.className = 'mermaid-btn';
    copyCodeBtn.textContent = 'Copy Code';
    copyCodeBtn.title = 'Copy Mermaid Source Code';

    const expandBtn = document.createElement('button');
    expandBtn.className = 'mermaid-btn mermaid-btn-highlight';
    expandBtn.textContent = '🔍 Expand';
    expandBtn.title = 'Open Fullscreen Pan & Zoom View';

    actions.appendChild(toggleBtn);
    actions.appendChild(copySvgBtn);
    actions.appendChild(copyCodeBtn);
    actions.appendChild(expandBtn);

    header.appendChild(titleEl);
    header.appendChild(actions);

    const viewport = document.createElement('div');
    viewport.className = 'mermaid-viewport';

    const sourceWrapper = document.createElement('div');
    sourceWrapper.className = 'mermaid-source-wrapper';
    sourceWrapper.style.display = 'none';

    const preClone = pre.cloneNode(true) as HTMLElement;
    sourceWrapper.appendChild(preClone);

    const errorBanner = document.createElement('div');
    errorBanner.className = 'mermaid-error';
    errorBanner.style.display = 'none';

    card.appendChild(header);
    card.appendChild(viewport);
    card.appendChild(sourceWrapper);
    card.appendChild(errorBanner);

    pre.parentNode?.replaceChild(card, pre);

    let showingSource = false;
    toggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      showingSource = !showingSource;
      sourceWrapper.style.display = showingSource ? 'block' : 'none';
      viewport.style.display = showingSource ? 'none' : 'flex';
      toggleBtn.textContent = showingSource ? 'Diagram' : 'Code';
    });

    copySvgBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const svgEl = viewport.querySelector('svg');
      if (svgEl) {
        copyFn(svgEl.outerHTML, copySvgBtn);
      }
    });

    copyCodeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      copyFn(mermaidCode.trim(), copyCodeBtn);
    });

    expandBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openMermaidModal(mermaidCode, viewport.innerHTML);
    });

    const svgId = `mermaid-render-${++mermaidCounter}`;
    try {
      const { svg } = await mermaid.render(svgId, mermaidCode);
      viewport.innerHTML = svg;
    } catch (err: any) {
      errorBanner.textContent = `Mermaid syntax notice: ${err?.message || 'Rendering error'}`;
      errorBanner.style.display = 'block';
      sourceWrapper.style.display = 'block';
      viewport.style.display = 'none';
      toggleBtn.textContent = 'Diagram';
    }
  }
}

function openMermaidModal(code: string, svgHtml: string) {
  if (!modalOverlay) {
    modalOverlay = document.createElement('div');
    modalOverlay.id = 'mermaid-modal-overlay';
    document.body.appendChild(modalOverlay);
  }

  modalOverlay.innerHTML = `
    <div class="mermaid-modal-dialog">
      <div class="mermaid-modal-header">
        <div class="mermaid-modal-title">
          <span>📊</span>
          <span>Mermaid Diagram - Fullscreen View</span>
        </div>
        <div class="mermaid-modal-controls">
          <span class="mermaid-modal-zoom-level" id="mermaid-zoom-val">100%</span>
          <button class="mermaid-modal-btn" id="mermaid-zoom-in" title="Zoom In (+)">+</button>
          <button class="mermaid-modal-btn" id="mermaid-zoom-out" title="Zoom Out (-)">-</button>
          <button class="mermaid-modal-btn" id="mermaid-zoom-reset" title="Reset View (1:1)">1:1</button>
          <button class="mermaid-modal-btn mermaid-modal-close" id="mermaid-modal-close" title="Close (Esc)">✕</button>
        </div>
      </div>
      <div class="mermaid-modal-body" id="mermaid-modal-body">
        <div class="mermaid-modal-canvas" id="mermaid-modal-canvas">
          ${svgHtml}
        </div>
      </div>
    </div>
  `;

  modalOverlay.style.display = 'flex';

  const canvas = modalOverlay.querySelector('#mermaid-modal-canvas') as HTMLElement;
  const body = modalOverlay.querySelector('#mermaid-modal-body') as HTMLElement;
  const zoomVal = modalOverlay.querySelector('#mermaid-zoom-val') as HTMLElement;

  currentZoom = 1;
  currentPanX = 0;
  currentPanY = 0;

  function updateTransform() {
    if (!canvas) return;
    canvas.style.transform = `translate(${currentPanX}px, ${currentPanY}px) scale(${currentZoom})`;
    if (zoomVal) zoomVal.textContent = `${Math.round(currentZoom * 100)}%`;
  }

  updateTransform();

  modalOverlay.querySelector('#mermaid-zoom-in')?.addEventListener('click', () => {
    currentZoom = Math.min(5, currentZoom + 0.25);
    updateTransform();
  });

  modalOverlay.querySelector('#mermaid-zoom-out')?.addEventListener('click', () => {
    currentZoom = Math.max(0.2, currentZoom - 0.25);
    updateTransform();
  });

  modalOverlay.querySelector('#mermaid-zoom-reset')?.addEventListener('click', () => {
    currentZoom = 1;
    currentPanX = 0;
    currentPanY = 0;
    updateTransform();
  });

  let isDragging = false;
  let startX = 0;
  let startY = 0;

  const onMouseMove = (e: MouseEvent) => {
    if (!isDragging) return;
    currentPanX = e.clientX - startX;
    currentPanY = e.clientY - startY;
    updateTransform();
  };

  const onMouseUp = () => {
    if (isDragging) {
      isDragging = false;
      if (body) body.style.cursor = 'grab';
    }
  };

  const closeModal = () => {
    if (modalOverlay) modalOverlay.style.display = 'none';
    document.removeEventListener('keydown', handleKeydown);
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);
  };

  modalOverlay.querySelector('#mermaid-modal-close')?.addEventListener('click', closeModal);

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') closeModal();
  }
  document.addEventListener('keydown', handleKeydown);

  body?.addEventListener('wheel', (e) => {
    e.preventDefault();
    const delta = e.deltaY < 0 ? 0.15 : -0.15;
    currentZoom = Math.min(5, Math.max(0.2, currentZoom + delta));
    updateTransform();
  }, { passive: false });

  body?.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    isDragging = true;
    startX = e.clientX - currentPanX;
    startY = e.clientY - currentPanY;
    body.style.cursor = 'grabbing';
  });

  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);
}
