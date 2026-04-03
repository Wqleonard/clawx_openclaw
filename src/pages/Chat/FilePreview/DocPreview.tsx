import { useEffect, useMemo, useRef, useState } from 'react';
import { ExternalLink, FileText } from 'lucide-react';
import { invokeIpc } from '@/lib/api-client';
import { hostApiFetch } from '@/lib/host-api';
import { renderAsync } from 'docx-preview';
import { getFileName } from './utils';
import './DocPreview.css';

type DocPreviewProps = {
  activeFile: string;
};

type FileContentResponse = {
  filePath: string;
  mimeType: string;
  fileSize: number;
  base64: string;
};

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function DocPreview({ activeFile }: DocPreviewProps) {
  const fileName = getFileName(activeFile);
  const lowerFileName = fileName.toLowerCase();
  const isDocxFile = lowerFileName.endsWith('.docx');
  const docxContainerRef = useRef<HTMLDivElement | null>(null);
  const requestPath = useMemo(
    () => `/api/files/content?filePath=${encodeURIComponent(activeFile)}`,
    [activeFile]
  );
  const [isLoading, setIsLoading] = useState(isDocxFile);
  const [loadError, setLoadError] = useState<string | null>(
    isDocxFile ? null : '当前仅支持 .docx 内嵌预览，请点击右上角“打开”查看 .doc 文件。'
  );

  useEffect(() => {
    let disposed = false;
    const container = docxContainerRef.current;
    void (async () => {
      if (!isDocxFile) return;
      if (!container) {
        setLoadError('文档预览容器初始化失败');
        setIsLoading(false);
        return;
      }
      container.innerHTML = '';
      try {
        const result = await hostApiFetch<FileContentResponse>(requestPath);
        if (disposed) return;
        const docxBytes = base64ToUint8Array(result.base64);
        await renderAsync(docxBytes, container, container, {
          inWrapper: true,
          ignoreWidth: false,
          ignoreHeight: false,
          breakPages: true,
          renderHeaders: true,
          renderFooters: true,
          renderFootnotes: true,
          renderEndnotes: true,
          useBase64URL: true,
        });
        if (disposed) return;
        setIsLoading(false);
      } catch (error) {
        if (disposed) return;
        setIsLoading(false);
        setLoadError(error instanceof Error ? error.message : String(error));
      }
    })();

    return () => {
      disposed = true;
      if (container) {
        container.innerHTML = '';
      }
    };
  }, [isDocxFile, requestPath]);

  return (
    <div className="flex h-full min-w-0 flex-col com-doc-preivew">
      <div className="h-11 shrink-0 border-b px-3 py-2 text-xs text-muted-foreground">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0 flex items-center gap-2">
            <FileText className="h-4 w-4" />
            <span className="truncate" title={activeFile}>
              {fileName}
            </span>
          </div>
          <button
            type="button"
            onClick={() => {
              void invokeIpc('shell:openPath', activeFile);
            }}
            className="inline-flex shrink-0 items-center gap-1 rounded border px-2 py-1 text-[11px] text-foreground transition-colors hover:bg-accent"
            title="在系统默认应用中打开"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            打开
          </button>
        </div>
      </div>
      <div className="relative min-h-0 flex-1 docx-wrapper-layout">
        <div
          ref={docxContainerRef}
          className={isLoading || loadError ? 'pointer-events-none invisible p-4' : ''}
        />
        {loadError ? (
          <div className="absolute inset-0 flex h-full items-center justify-center px-4">
            <div className="rounded-2xl border border-dashed border-black/10 bg-black/[0.02] px-8 py-7 text-center dark:border-white/10 dark:bg-white/[0.03]">
              <p className="text-sm text-muted-foreground">
                文档预览加载失败：{loadError}
              </p>
            </div>
          </div>
        ) : isLoading ? (
          <div className="absolute inset-0 flex h-full items-center justify-center text-sm text-muted-foreground">
            正在加载文档预览...
          </div>
        ) : null}
      </div>
    </div>
  );
}
