import { useEffect, useMemo, useState } from 'react';
import { FileImage, FileText, ImageOff } from 'lucide-react';
import { MarkdownEditor } from '@/components/markdownEditor';
import { hostApiFetch } from '@/lib/host-api';

const MARKDOWN_EXTENSIONS = ['.md', '.markdown', '.mdx'] as const;
const IMAGE_EXTENSIONS = [
  '.apng',
  '.avif',
  '.bmp',
  '.gif',
  '.ico',
  '.jfif',
  '.jpeg',
  '.jpg',
  '.pjpeg',
  '.pjp',
  '.png',
  '.svg',
  '.tif',
  '.tiff',
  '.webp',
] as const;

type FilePreviewKind = 'markdown' | 'image' | 'unsupported' | 'none';

type FilePreviewProps = {
  activeFile: string | null;
  fileContent: string;
  mdViewMode: 'source' | 'rendered';
  onMdViewModeChange: (mode: 'source' | 'rendered') => void;
  onMarkdownChange: (nextMarkdown: string) => void;
};

function hasAnyExtension(filePath: string, extensions: readonly string[]): boolean {
  const lower = filePath.toLowerCase();
  return extensions.some((ext) => lower.endsWith(ext));
}

function getPreviewKind(filePath: string | null): FilePreviewKind {
  if (!filePath) return 'none';
  if (hasAnyExtension(filePath, MARKDOWN_EXTENSIONS)) return 'markdown';
  if (hasAnyExtension(filePath, IMAGE_EXTENSIONS)) return 'image';
  return 'unsupported';
}

function getFileName(filePath: string): string {
  const normalized = filePath.replace(/[\\/]+/g, '/');
  const parts = normalized.split('/');
  return parts[parts.length - 1] || filePath;
}

function getMimeTypeByPath(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.jfif')) {
    return 'image/jpeg';
  }
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.svg')) return 'image/svg+xml';
  if (lower.endsWith('.bmp')) return 'image/bmp';
  if (lower.endsWith('.ico')) return 'image/x-icon';
  if (lower.endsWith('.avif')) return 'image/avif';
  if (lower.endsWith('.apng')) return 'image/apng';
  if (lower.endsWith('.tif') || lower.endsWith('.tiff')) return 'image/tiff';
  return 'application/octet-stream';
}

export function FilePreview({
  activeFile,
  fileContent,
  mdViewMode,
  onMdViewModeChange,
  onMarkdownChange,
}: FilePreviewProps) {
  const previewKind = useMemo(() => getPreviewKind(activeFile), [activeFile]);
  const [failedImagePath, setFailedImagePath] = useState<string | null>(null);
  const [imageSrcByPath, setImageSrcByPath] = useState<Record<string, string>>({});

  useEffect(() => {
    if (previewKind !== 'image' || !activeFile || imageSrcByPath[activeFile]) return;
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
  }, [activeFile, imageSrcByPath, previewKind]);

  if (previewKind === 'none') {
    return (
      <div className="flex h-full items-center justify-center px-4">
        <div className="rounded-2xl border border-dashed border-black/10 bg-black/[0.02] px-8 py-7 text-center dark:border-white/10 dark:bg-white/[0.03]">
          <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-white shadow-sm ring-1 ring-black/5 dark:bg-black/20 dark:ring-white/10">
            <FileText className="h-5 w-5 text-foreground/60" />
          </div>
          <p className="text-sm text-muted-foreground">
            点击文件树中的文件后，会在这里显示内容预览
          </p>
        </div>
      </div>
    );
  }

  if (previewKind === 'markdown') {
    return (
      <div className="w-full h-full flex flex-col">
        <MarkdownEditor
          className="flex-1 min-h-0"
          value={fileContent}
          mode={mdViewMode}
          onModeChange={onMdViewModeChange}
          onChange={onMarkdownChange}
        />
      </div>
    );
  }

  if (previewKind === 'image' && activeFile) {
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

  return (
    <div className="flex h-full items-center justify-center px-4">
      <div className="rounded-2xl border border-dashed border-black/10 bg-black/[0.02] px-8 py-7 text-center dark:border-white/10 dark:bg-white/[0.03]">
        <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-white shadow-sm ring-1 ring-black/5 dark:bg-black/20 dark:ring-white/10">
          <FileText className="h-5 w-5 text-foreground/60" />
        </div>
        <p className="text-sm text-muted-foreground">
          当前文件类型暂不支持预览：{activeFile ? getFileName(activeFile) : ''}
        </p>
      </div>
    </div>
  );
}
