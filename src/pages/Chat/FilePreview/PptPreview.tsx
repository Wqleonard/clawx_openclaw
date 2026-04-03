import { useEffect, useMemo, useRef, useState } from 'react';
import { ExternalLink, FileText } from 'lucide-react';
import 'chart.js/auto';
import { invokeIpc } from '@/lib/api-client';
import { hostApiFetch } from '@/lib/host-api';
import { getFileName } from './utils';
import { PPTXViewer } from 'pptxviewjs';

type PptPreviewProps = {
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

export function PptPreview({ activeFile }: PptPreviewProps) {
  const fileName = getFileName(activeFile);
  const lowerFileName = fileName.toLowerCase();
  const isPptxFile = lowerFileName.endsWith('.pptx');
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const viewerRef = useRef<PPTXViewer | null>(null);
  const requestPath = useMemo(
    () => `/api/files/content?filePath=${encodeURIComponent(activeFile)}`,
    [activeFile]
  );
  const [slideCount, setSlideCount] = useState(0);
  const [currentSlide, setCurrentSlide] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;

    if (!isPptxFile) {
      return () => {
        disposed = true;
      };
    }

    const canvas = canvasRef.current;
    if (!canvas) {
      return () => {
        disposed = true;
      };
    }

    void hostApiFetch<FileContentResponse>(requestPath)
      .then(async (result) => {
        if (disposed) return;
        const viewer = new PPTXViewer({ canvas });
        viewerRef.current = viewer;
        await viewer.loadFile(base64ToUint8Array(result.base64));
        await viewer.render(canvas);
        if (disposed) return;
        const total = viewer.getSlideCount();
        const current = viewer.getCurrentSlideIndex() + 1;
        setSlideCount(total);
        setCurrentSlide(current);
        setLoading(false);
      })
      .catch((error) => {
        if (disposed) return;
        setLoading(false);
        setLoadError(error instanceof Error ? error.message : String(error));
      });

    return () => {
      disposed = true;
      viewerRef.current?.destroy();
      viewerRef.current = null;
    };
  }, [isPptxFile, requestPath]);

  const goPrevSlide = async () => {
    const viewer = viewerRef.current;
    const canvas = canvasRef.current;
    if (!viewer || !canvas) return;
    await viewer.previousSlide(canvas);
    setCurrentSlide(viewer.getCurrentSlideIndex() + 1);
  };

  const goNextSlide = async () => {
    const viewer = viewerRef.current;
    const canvas = canvasRef.current;
    if (!viewer || !canvas) return;
    await viewer.nextSlide(canvas);
    setCurrentSlide(viewer.getCurrentSlideIndex() + 1);
  };

  return (
    <div className="flex h-full min-w-0 flex-col">
      <div className="h-11 shrink-0 border-b px-3 py-2 text-xs text-muted-foreground">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0 flex items-center gap-2">
            <FileText className="h-4 w-4 shrink-0" />
            <span className="truncate flex-1" title={activeFile}>
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
      <div className="min-h-0 flex-1 overflow-auto p-4">
        {!isPptxFile ? (
          <div className="flex h-full items-center justify-center px-4">
            <div className="rounded-2xl border border-dashed border-black/10 bg-black/[0.02] px-8 py-7 text-center dark:border-white/10 dark:bg-white/[0.03]">
              <p className="text-sm text-muted-foreground">
                当前仅支持 .pptx 内嵌预览，.ppt 请点击右上角“打开”查看。
              </p>
            </div>
          </div>
        ) : loadError ? (
          <div className="flex h-full items-center justify-center px-4">
            <div className="rounded-2xl border border-dashed border-black/10 bg-black/[0.02] px-8 py-7 text-center dark:border-white/10 dark:bg-white/[0.03]">
              <p className="text-sm text-muted-foreground">演示文稿预览加载失败：{loadError}</p>
            </div>
          </div>
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <canvas
              ref={canvasRef}
              className="block w-full h-auto rounded border bg-white shadow-sm"
            />
            {loading ? (
              <div className="absolute text-sm text-muted-foreground">正在加载演示文稿预览...</div>
            ) : null}
          </div>
        )}
      </div>
      <div className="h-10 shrink-0 border-t px-3 py-2 text-xs text-muted-foreground flex items-center justify-between">
        <span>
          {!isPptxFile ? '演示文稿预览' : (slideCount > 0 ? `第 ${currentSlide} / ${slideCount} 页` : '演示文稿预览')}
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="rounded border px-2 py-1 text-[11px] text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => { void goPrevSlide(); }}
            disabled={!isPptxFile || loading || !!loadError || currentSlide <= 1}
          >
            上一页
          </button>
          <button
            type="button"
            className="rounded border px-2 py-1 text-[11px] text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => { void goNextSlide(); }}
            disabled={!isPptxFile || loading || !!loadError || slideCount === 0 || currentSlide >= slideCount}
          >
            下一页
          </button>
        </div>
      </div>
    </div>
  );
}
