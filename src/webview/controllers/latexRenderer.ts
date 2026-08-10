import katex from 'katex';
import renderMathInElement from 'katex/contrib/auto-render';

const TEX_COMMAND_RE = /\\(?:int|frac|sum|sqrt|begin|matrix|mathbf|mathcal|mathbb|mathrm|alpha|beta|gamma|delta|epsilon|theta|lambda|mu|sigma|omega|phi|psi|pi|infty|partial|nabla|left|right|cdot|times|div|pm|mp|le|ge|lt|gt|leq|geq|neq|approx|equiv|subset|supset|cup|cap|forall|exists|lim|log|ln|sin|cos|tan|exp|det|max|min|sup|inf|binom|choose|text|operatorname|displaystyle)\b/;

function promoteCodeSpansToMath(container: HTMLElement) {
  const codeEls = container.querySelectorAll('code');
  codeEls.forEach((code) => {
    if (code.closest('pre')) return;
    const text = code.textContent || '';
    if (TEX_COMMAND_RE.test(text) && !text.includes('`')) {
      const math = document.createTextNode(`$${text}$`);
      code.replaceWith(math);
    }
  });
}

function prepareMathInElement(container: HTMLElement) {
  promoteCodeSpansToMath(container);

  // Process block-level elements (p, div, li, blockquote) first to catch multiline LaTeX environments and brackets
  const blocks = container.querySelectorAll('p, div, li, blockquote');
  blocks.forEach((block) => {
    if (block.querySelector('pre, code, .katex')) return;

    const text = block.textContent || '';
    if (!text.trim()) return;

    // Promote standalone bracket-delimited display math: [ \int ... ] or [ \begin{...} ... ] across lines
    if (/^\s*\[\s*\\/.test(text) && /\s*\]\s*$/.test(text) && (TEX_COMMAND_RE.test(text) || /\\begin\{/i.test(text))) {
      const inner = text.replace(/^\s*\[\s*/, '').replace(/\s*\]\s*$/, '');
      if (inner.trim()) {
        block.textContent = `$$${inner.trim()}$$`;
        return;
      }
    }

    // Wrap un-enclosed \begin{env}...\end{env} blocks in display math ($$...$$) across multiline blocks
    if (/\\begin\{[a-z0-9*]+\}/i.test(text) && /\\end\{[a-z0-9*]+\}/i.test(text) && !text.includes('$$')) {
      const wrapped = text.replace(/(\\begin\{[a-z0-9*]+\}[\s\S]*?\\end\{[a-z0-9*]+\})/gi, '$$$$$1$$$$');
      if (wrapped !== text) {
        block.textContent = wrapped;
      }
    }
  });

  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      let parent = node.parentElement;
      while (parent && parent !== container) {
        const tag = parent.tagName.toLowerCase();
        if (tag === 'pre' || tag === 'code' || parent.classList.contains('katex')) {
          return NodeFilter.FILTER_REJECT;
        }
        parent = parent.parentElement;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const textNodes: Text[] = [];
  let node: Node | null;
  while ((node = walker.nextNode())) {
    textNodes.push(node as Text);
  }

  for (const textNode of textNodes) {
    const text = textNode.textContent || '';

    // Fix emphasis tags inside inline math: markdown converts _x_ to <em>x</em>
    const parent = textNode.parentElement;
    if (parent && (parent.tagName === 'EM' || parent.tagName === 'I')) {
      const prevSib = parent.previousSibling;
      const nextSib = parent.nextSibling;
      if (prevSib && prevSib.textContent?.includes('$') && nextSib && nextSib.textContent?.includes('$')) {
        const restored = document.createTextNode(`_${text}_`);
        parent.replaceWith(restored);
      }
    }

    // Wrap standalone \begin{env}...\end{env} in display math
    if (/\\begin\{[a-z0-9*]+\}/i.test(text) && /\\end\{[a-z0-9*]+\}/i.test(text) && !text.includes('$$')) {
      const wrapped = text.replace(/(\\begin\{[a-z0-9*]+\}[\s\S]*?\\end\{[a-z0-9*]+\})/gi, '$$$$$1$$$$');
      if (wrapped !== text) {
        textNode.textContent = wrapped;
      }
    }

    // Promote standalone bracket-delimited math: [ \int ... ] -> $$ ... $$
    if (/^\s*\[/.test(text) && /\]\s*$/.test(text) && TEX_COMMAND_RE.test(text)) {
      const inner = text.replace(/^\s*\[\s*/, '').replace(/\s*\]\s*$/, '');
      if (inner.trim()) {
        textNode.textContent = `$$${inner}$$`;
      }
    }
  }
}

export function renderLaTeX(container: HTMLElement) {
  if (typeof renderMathInElement !== 'function') return;

  prepareMathInElement(container);

  try {
    renderMathInElement(container, {
      delimiters: [
        { left: '$$', right: '$$', display: true },
        { left: '\\[', right: '\\]', display: true },
        { left: '$', right: '$', display: false },
        { left: '\\(', right: '\\)', display: false },
      ],
      ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code', 'option'],
      throwOnError: false,
    });
  } catch {
    // silently ignore render errors
  }
}
