import { useEffect, useState } from 'react';
import { FileImage, ImageOff } from 'lucide-react';
import { hostApiFetch } from '@/lib/host-api.ts';
import { getFileName, getMimeTypeByPath } from './utils';

type ImagePreviewProps = {
  activeFile: string;
};

export function ImagePreview({ activeFile }: ImagePreviewProps) {
  const [failedImagePath, setFailedImagePath] = useState<string | null>(null);
  const [imageSrcByPath, setImageSrcByPath] = useState<Record<string, string>>({});

  useEffect(() => {
    if (imageSrcByPath[activeFile]) return;
    const filePath = activeFile;
    void hostApiFetch<Record<string, { preview: string | null; fileSize: number }>>(
      '/api/files/thumbnails',
      {
        method: 'POST',
        body: JSON.stringify({
          paths: [{ filePath, mimeType: getMimeTypeByPath(filePath) }],
        }),
      }
    )
      .then((result) => {
        const nextSrc = result[filePath]?.preview;
        if (!nextSrc) {
          setFailedImagePath(filePath);
          return;
        }
        setImageSrcByPath((prev) => ({ ...prev, [filePath]: nextSrc }));
      })
      .catch(() => {
        setFailedImagePath(filePath);
      });
  }, [activeFile, imageSrcByPath]);

  const imageLoadError = failedImagePath === activeFile;
  const imageSrc = imageSrcByPath[activeFile];

  return (
    <div className="flex h-full min-w-0 flex-col">
      <div className="h-11 flex shrink-0 items-center gap-2 border-b px-3 py-2 text-xs text-muted-foreground">
        <FileImage className="h-4 w-4" />
        <span className="truncate" title={activeFile}>
          {getFileName(activeFile)}
        </span>
      </div>
      <div className="relative min-h-0 flex-1 flex items-center justify-center overflow-auto">
        {!imageLoadError && imageSrc ? (
          <img
            src={imageSrc}
            alt={getFileName(activeFile)}
            className="mx-auto block h-auto max-h-full w-auto max-w-full object-contain p-4"
            onError={() => setFailedImagePath(activeFile)}
            loading="lazy"
          />
        ) : !imageLoadError ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            正在加载图片预览...
          </div>
        ) : (
          <div className="flex h-full items-center justify-center px-4">
            <div className="rounded-2xl border border-dashed border-black/10 bg-black/[0.02] px-8 py-7 text-center dark:border-white/10 dark:bg-white/[0.03]">
              <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-white shadow-sm ring-1 ring-black/5 dark:bg-black/20 dark:ring-white/10">
                <ImageOff className="h-5 w-5 text-foreground/60" />
              </div>
              <p className="text-sm text-muted-foreground">图片加载失败，可能是格式或权限不支持</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
