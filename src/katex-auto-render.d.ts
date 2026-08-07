declare module 'katex/contrib/auto-render' {
  interface RenderMathInElementOptions {
    delimiters?: Array<{ left: string; right: string; display: boolean }>;
    ignoredTags?: string[];
    ignoredClasses?: string[];
    throwOnError?: boolean;
    errorColor?: string;
  }
  function renderMathInElement(
    element: HTMLElement,
    options?: RenderMathInElementOptions,
  ): void;
  export default renderMathInElement;
}
