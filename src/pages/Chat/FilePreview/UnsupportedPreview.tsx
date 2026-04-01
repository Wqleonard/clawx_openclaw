import { FileText } from 'lucide-react';
import { getFileName } from './utils';

type UnsupportedPreviewProps = {
  activeFile: string | null;
};

export function UnsupportedPreview({ activeFile }: UnsupportedPreviewProps) {
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
