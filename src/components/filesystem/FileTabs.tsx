import { useMemo } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

type FileTabsProps = {
  openFiles: string[];
  activeFile: string | null;
  dirtyFiles: string[];
  onSelectFile: (filePath: string) => void;
  onCloseFile: (filePath: string) => void;
};

function labelsForLanguage(language: string): { empty: string; close: string } {
  const isZh = language.toLowerCase().startsWith('zh');
  if (isZh) {
    return {
      empty: '暂无打开文件',
      close: '关闭',
    };
  }
  return {
    empty: 'No open files',
    close: 'Close',
  };
}

function baseName(filePath: string): string {
  const parts = filePath.split(/[\\/]/);
  return parts[parts.length - 1] || filePath;
}

export function FileTabs({
  openFiles,
  activeFile,
  dirtyFiles,
  onSelectFile,
  onCloseFile,
}: FileTabsProps) {
  const labels = useMemo(() => labelsForLanguage(navigator.language || 'en'), []);

  if (openFiles.length === 0) {
    return (
      <div className="flex h-9 items-center border-b border-border px-3 text-xs text-muted-foreground">
        {labels.empty}
      </div>
    );
  }

  return (
    <div className="flex h-11 items-center gap-3 overflow-x-auto border-b border-border px-1.5">
      {openFiles.map((filePath) => {
        const isActive = activeFile === filePath;
        const isDirty = dirtyFiles.includes(filePath);
        return (
          <div className={cn(
            'h-full flex items-center',
            isActive && 'border-b border-[var(--tab-active)]'
          )}>
            <button
              key={filePath}
              type="button"
              className={cn(
                'group flex h-7 shrink-0 items-center gap-1 rounded-md border px-2 text-xs transition-colors',
                isActive
                  ? 'border-border bg-background text-foreground'
                  : 'border-transparent text-muted-foreground hover:border-border/60 hover:bg-background/60',
              )}
              onClick={() => onSelectFile(filePath)}
              title={filePath}
            >
            <span className="max-w-40 truncate">
              {baseName(filePath)}
              {isDirty ? ' *' : ''}
            </span>
              <span
                className={cn(
                  'inline-flex h-4 w-4 items-center justify-center rounded text-muted-foreground/70 transition-colors',
                  'hover:bg-muted hover:text-foreground',
                )}
                role="button"
                aria-label={`${labels.close} ${baseName(filePath)}`}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onCloseFile(filePath);
                }}
              >
              <X className="h-3 w-3" />
            </span>
            </button>
          </div>
        );
      })}
    </div>
  );
}
