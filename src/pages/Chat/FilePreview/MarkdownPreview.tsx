import { MarkdownEditor } from '@/components/markdownEditor';
import type { MdViewMode } from './types';

type MarkdownPreviewProps = {
  fileContent: string;
  mdViewMode: MdViewMode;
  onMdViewModeChange: (mode: MdViewMode) => void;
  onMarkdownChange: (nextMarkdown: string) => void;
};

export function MarkdownPreview({
  fileContent,
  mdViewMode,
  onMdViewModeChange,
  onMarkdownChange,
}: MarkdownPreviewProps) {
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
