import { useEffect, useMemo, useState } from 'react';
import { ExternalLink, FileText } from 'lucide-react';
import { invokeIpc } from '@/lib/api-client';
import { hostApiFetch } from '@/lib/host-api';
import { getFileName } from './utils';

type PdfPreviewProps = {
  activeFile: string;
};

type FileContentResponse = {
  filePath: string;
  mimeType: string;
  fileSize: number;
  base64: string;
};

function createBlobUrlFromBase64(base64: string, mimeType: string): string {
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  const blob = new Blob([bytes], { type: mimeType || 'application/pdf' });
  return URL.createObjectURL(blob);
}

export function PdfPreview({ activeFile }: PdfPreviewProps) {
  const fileName = getFileName(activeFile);
  const requestPath = useMemo(
    () => `/api/files/content?filePath=${encodeURIComponent(activeFile)}`,
    [activeFile]
  );
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    let currentUrl: string | null = null;

    setPdfBlobUrl(null);
    setLoadError(null);

    void hostApiFetch<FileContentResponse>(requestPath)
      .then((result) => {
        if (disposed) return;
        currentUrl = createBlobUrlFromBase64(result.base64, result.mimeType);
        setPdfBlobUrl(currentUrl);
      })
      .catch((error) => {
        if (disposed) return;
        setLoadError(error instanceof Error ? error.message : String(error));
      });

    return () => {
      disposed = true;
      if (currentUrl) {
        URL.revokeObjectURL(currentUrl);
      }
    };
  }, [requestPath]);

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
      <div className="min-h-0 flex-1 overflow-hidden bg-muted/20">
        {pdfBlobUrl ? (
          <iframe
            key={activeFile}
            src={pdfBlobUrl}
            title={`PDF Preview - ${fileName}`}
            className="h-full w-full border-0"
          />
        ) : loadError ? (
          <div className="flex h-full items-center justify-center px-4">
            <div className="rounded-2xl border border-dashed border-black/10 bg-black/[0.02] px-8 py-7 text-center dark:border-white/10 dark:bg-white/[0.03]">
              <p className="text-sm text-muted-foreground">
                PDF 预览加载失败：{loadError}
              </p>
            </div>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            正在加载 PDF 预览...
          </div>
        )}
      </div>
    </div>
  );
}
