import { FileTypeCorner } from 'lucide-react';
import { getFileName } from './utils';

type TextPreviewProps = {
  activeFile: string;
  fileContent: string;
  onTextChange: (nextText: string) => void;
};

export function TextPreview({ activeFile, fileContent, onTextChange }: TextPreviewProps) {
  return (
    <div className="w-full h-full flex flex-col">
      <div className="h-11 flex shrink-0 items-center gap-2 border-b px-3 py-2 text-xs text-muted-foreground">
        <FileTypeCorner className="h-4 w-4" />
        <span className="truncate" title={activeFile}>
          {getFileName(activeFile)}
        </span>
      </div>
      <textarea
        className="flex-1 min-h-0 w-full resize-none border-0 bg-transparent p-4 text-sm leading-relaxed text-foreground outline-none"
        value={fileContent}
        onChange={(event) => onTextChange(event.target.value)}
        spellCheck={false}
      />
    </div>
  );
}
