import katex from 'katex';
import renderMathInElement from 'katex/contrib/auto-render';

const TEX_COMMAND_RE = /\\(?:int|frac|sum|sqrt|begin|matrix|mathbf|mathcal|mathbb|mathrm|alpha|beta|gamma|delta|epsilon|theta|lambda|mu|sigma|omega|phi|psi|pi|infty|partial|nabla|left|right|cdot|times|div|pm|mp|le|ge|lt|gt|leq|geq|neq|approx|equiv|subset|supset|cup|cap|forall|exists|lim|log|ln|sin|cos|tan|exp|det|max|min|sup|inf|binom|choose|text|operatorname|displaystyle)\b/;

export interface MathToken {
  placeholder: string;
  math: string;
  displayMode: boolean;
}

export function extractMathTokens(text: string): { text: string; tokens: MathToken[] } {
  if (!text) return { text: '', tokens: [] };

  const tokens: MathToken[] = [];
  let tokenIdx = 0;

  // 1. Display math blocks: $$ ... $$ or \[ ... \] or \begin{env}...\end{env}
  let processed = text.replace(/\$\$([\s\S]*?)\$\$|\\\[([\s\S]*?)\\\]|(\\begin\{[a-zA-Z0-9*]+\}[\s\S]*?\\end\{[a-zA-Z0-9*]+\})/g, (_match, d1, d2, d3) => {
    const mathContent = d1 ?? d2 ?? d3 ?? '';
    const placeholder = `%%ORBIT_MATH_BLOCK_${tokenIdx++}%%`;
    tokens.push({
      placeholder,
      math: mathContent.trim(),
      displayMode: true,
    });
    return placeholder;
  });

  // 2. Inline math: $ ... $ or \( ... \) (avoiding currency like $5 or $10.00)
  processed = processed.replace(/(^|[^\\])\$([^\s$](?:[^$]*[^\s$])?)\$|\\\(([\s\S]*?)\\\)/g, (match, prefix, i1, i2) => {
    const mathContent = i1 ?? i2 ?? '';
    // Skip if it looks like currency ($10, $5.99, etc.) without LaTeX commands
    if (/^\d+(?:\.\d+)?$/.test(mathContent.trim()) && !TEX_COMMAND_RE.test(mathContent)) {
      return match;
    }
    const pre = prefix || '';
    const placeholder = `%%ORBIT_MATH_INLINE_${tokenIdx++}%%`;
    tokens.push({
      placeholder,
      math: mathContent.trim(),
      displayMode: false,
    });
    return pre + placeholder;
  });

  return { text: processed, tokens };
}

export function restoreMathTokens(html: string, tokens: MathToken[]): string {
  if (!tokens || tokens.length === 0) return html;

  let result = html;
  for (const token of tokens) {
    try {
      const rendered = katex.renderToString(token.math, {
        displayMode: token.displayMode,
        throwOnError: false,
      });
      const wrapped = token.displayMode
        ? `<div class="katex-display-wrapper">${rendered}</div>`
        : `<span class="katex-inline-wrapper">${rendered}</span>`;
      result = result.replace(token.placeholder, wrapped);
    } catch {
      const fallback = token.displayMode ? `$$${token.math}$$` : `$${token.math}$`;
      result = result.replace(token.placeholder, fallback);
    }
  }
  return result;
}

export function preprocessMarkdownMath(text: string): string {
  if (!text) return text;
  return text;
}

export function renderLaTeX(container: HTMLElement) {
  if (typeof renderMathInElement !== 'function') return;

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

