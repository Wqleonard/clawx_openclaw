import { useEffect, useMemo, useState } from 'react';
import { ExternalLink, FileText } from 'lucide-react';
import { invokeIpc } from '@/lib/api-client';
import { hostApiFetch } from '@/lib/host-api';
import { getFileName } from './utils';

type DocPreviewProps = {
  activeFile: string;
};

type FileContentResponse = {
  filePath: string;
  mimeType: string;
  fileSize: number;
  base64: string;
};

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

export function DocPreview({ activeFile }: DocPreviewProps) {
  const fileName = getFileName(activeFile);
  const lowerFileName = fileName.toLowerCase();
  const isDocxFile = lowerFileName.endsWith('.docx');
  const requestPath = useMemo(
    () => `/api/files/content?filePath=${encodeURIComponent(activeFile)}`,
    [activeFile]
  );
  const [docHtml, setDocHtml] = useState<string>('');
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;

    setDocHtml('');
    setLoadError(null);

    if (!isDocxFile) {
      setLoadError('当前仅支持 .docx 内嵌预览，请点击右上角“打开”查看 .doc 文件。');
      return () => {
        disposed = true;
      };
    }

    void hostApiFetch<FileContentResponse>(requestPath)
      .then(async (result) => {
        if (disposed) return;
        const mammoth = await import('mammoth');
        const arrayBuffer = base64ToArrayBuffer(result.base64);
        const converted = await mammoth.convertToHtml({ arrayBuffer });
        if (disposed) return;
        setDocHtml(converted.value || '<p>文档内容为空。</p>');
      })
      .catch((error) => {
        if (disposed) return;
        setLoadError(error instanceof Error ? error.message : String(error));
      });

    return () => {
      disposed = true;
    };
  }, [isDocxFile, requestPath]);

  return (
    <div className="flex h-full min-w-0 flex-col">
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
      <div className="min-h-0 flex-1 overflow-auto bg-muted/20">
        {docHtml ? (
          <article
            className="prose prose-sm dark:prose-invert max-w-none p-4"
            dangerouslySetInnerHTML={{ __html: docHtml }}
          />
        ) : loadError ? (
          <div className="flex h-full items-center justify-center px-4">
            <div className="rounded-2xl border border-dashed border-black/10 bg-black/[0.02] px-8 py-7 text-center dark:border-white/10 dark:bg-white/[0.03]">
              <p className="text-sm text-muted-foreground">
                文档预览加载失败：{loadError}
              </p>
            </div>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            正在加载文档预览...
          </div>
        )}
      </div>
    </div>
  );
}
