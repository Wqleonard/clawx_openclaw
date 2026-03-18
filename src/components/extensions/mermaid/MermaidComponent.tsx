import React, { useCallback, useEffect, useRef, useState } from 'react';
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import mermaid from 'mermaid';

let mermaidInited = false;

const initMermaid = () => {
  if (mermaidInited || typeof window === 'undefined') return;
  mermaid.initialize({
    startOnLoad: false,
    theme: 'default',
    securityLevel: 'loose',
    flowchart: {
      useMaxWidth: true,
      htmlLabels: true,
    },
  });
  mermaidInited = true;
};

initMermaid();

const MermaidComponent: React.FC<NodeViewProps> = ({ node }) => {
  const mermaidRef = useRef<HTMLDivElement | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  // 用 ref 追踪上一次渲染的 code，避免 code 未变时重复渲染
  const lastRenderedCodeRef = useRef<string | null>(null);
  const renderIdRef = useRef('');

  const code = ((node.attrs?.code as string) || '').trim();

  const renderMermaid = useCallback(async (codeToRender: string) => {
    if (!codeToRender) {
      setIsLoading(false);
      return;
    }
    if (!mermaidRef.current) return;

    setIsLoading(true);
    setHasError(false);
    setErrorMessage('');

    try {
      mermaidRef.current.innerHTML = '';
      const renderId = `mermaid-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
      renderIdRef.current = renderId;
      const { svg } = await mermaid.render(renderId, codeToRender);
      if (mermaidRef.current) {
        mermaidRef.current.innerHTML = svg;
      }
      lastRenderedCodeRef.current = codeToRender;
      setIsLoading(false);
    } catch (error) {
      setHasError(true);
      setIsLoading(false);
      const errorDiv = document.querySelector(`#${renderIdRef.current}`);
      const errorDiv2 = document.querySelector(`#d${renderIdRef.current}`);
      errorDiv?.remove();
      errorDiv2?.remove();
      if (mermaidRef.current) mermaidRef.current.innerHTML = '';
      setErrorMessage(
        error instanceof Error ? error.message || 'Mermaid 图表渲染失败' : 'Mermaid 图表渲染失败'
      );
    }
  }, []);

  // code 变化时才重新渲染，跳过相同内容的重复渲染
  useEffect(() => {
    if (code === lastRenderedCodeRef.current) return;

    let cancelled = false;
    const taskId = window.setTimeout(() => {
      if (cancelled) return;
      void renderMermaid(code);
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(taskId);
    };
  }, [code, renderMermaid]);

  useEffect(() => {
    const currentMermaidRef = mermaidRef.current;
    return () => {
      if (currentMermaidRef) currentMermaidRef.innerHTML = '';
    };
  }, []);

  return (
    <NodeViewWrapper className="relative my-4 min-h-[200px] rounded-md border border-border/70 bg-muted/30 px-4 pt-12 pb-4">
      {isLoading && (
        <div className="p-8 text-center text-sm text-muted-foreground">
          正在渲染 Mermaid 图表...
        </div>
      )}
      {hasError && (
        <div className="my-4 rounded-md border border-yellow-400/70 bg-yellow-100/70 p-6 shadow-sm dark:border-yellow-500/70 dark:bg-yellow-900/30">
          <div className="mb-3 text-base font-bold text-yellow-900 dark:text-yellow-200">
            ⚠️ Mermaid 语法错误
          </div>
          <div className="mb-3 break-words rounded-sm bg-white/60 p-3 text-sm text-yellow-900 dark:bg-black/20 dark:text-yellow-100">
            {errorMessage}
          </div>
          <div className="border-t border-dashed border-yellow-500/70 pt-2 text-center text-xs italic text-yellow-800 dark:text-yellow-200">
            提示：点击右上角"编辑"按钮修改代码
          </div>
        </div>
      )}
      <div
        ref={mermaidRef}
        className="flex min-h-[100px] items-center justify-center overflow-x-auto [&_svg]:h-auto [&_svg]:max-w-full"
      />
    </NodeViewWrapper>
  );
};

export default MermaidComponent;
