let log: HTMLElement;
let scrollToBottomPillEl: HTMLElement | null = null;

export let isUserScrolledUp = false;
export let dirtyWhileScrolledUp = false;
export let isRendering = false;

let onScrollToBottomClick: () => void;

export function initScrollManager(
  logEl: HTMLElement,
  onScrollToBottom: () => void,
) {
  log = logEl;
  onScrollToBottomClick = onScrollToBottom;

  const markUserScrolled = () => {
    if (isRendering) return;
    const distanceFromBottom = log.scrollHeight - log.scrollTop - log.clientHeight;
    if (distanceFromBottom > 60) {
      isUserScrolledUp = true;
    } else {
      const wasScrolledUp = isUserScrolledUp;
      isUserScrolledUp = false;
      hideScrollToBottomPill();
      if (wasScrolledUp && dirtyWhileScrolledUp) {
        dirtyWhileScrolledUp = false;
        onScrollToBottomClick();
      }
    }
  };

  log.addEventListener('wheel', markUserScrolled, { passive: true });
  log.addEventListener('touchmove', markUserScrolled, { passive: true });
  log.addEventListener('scroll', markUserScrolled, { passive: true });
}

export function setIsRendering(value: boolean) {
  isRendering = value;
}

export function setDirtyWhileScrolledUp(value: boolean) {
  dirtyWhileScrolledUp = value;
}

export function resetScrollState() {
  isUserScrolledUp = false;
  dirtyWhileScrolledUp = false;
  hideScrollToBottomPill();
}

function getScrollToBottomPill(): HTMLElement {
  if (!scrollToBottomPillEl) {
    scrollToBottomPillEl = document.createElement('div');
    scrollToBottomPillEl.className = 'scroll-to-bottom-pill';
    scrollToBottomPillEl.innerHTML = `<span class="scroll-to-bottom-pill-arrow">↓</span><span>New activity below</span>`;
    scrollToBottomPillEl.onclick = () => {
      isUserScrolledUp = false;
      dirtyWhileScrolledUp = false;
      hideScrollToBottomPill();
      onScrollToBottomClick();
    };
    document.body.appendChild(scrollToBottomPillEl);
  }
  return scrollToBottomPillEl;
}

export function showScrollToBottomPill() {
  const pill = getScrollToBottomPill();
  pill.classList.add('visible');
}

export function hideScrollToBottomPill() {
  if (scrollToBottomPillEl) {
    scrollToBottomPillEl.classList.remove('visible');
  }
}

export function scrollToBottom() {
  if (log) log.scrollTop = log.scrollHeight;
}

export function getScrollMetrics() {
  const prevScrollTop = log.scrollTop;
  const prevScrollHeight = log.scrollHeight;
  const distanceFromBottom = prevScrollHeight - prevScrollTop - log.clientHeight;
  return { wasAtBottom: distanceFromBottom <= 60 };
}
