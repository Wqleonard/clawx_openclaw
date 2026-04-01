export type MdViewMode = 'source' | 'rendered';

export type FilePreviewKind = 'markdown' | 'image' | 'unsupported' | 'none';

export type FilePreviewProps = {
  activeFile: string | null;
  fileContent: string;
  mdViewMode: MdViewMode;
  onMdViewModeChange: (mode: MdViewMode) => void;
  onMarkdownChange: (nextMarkdown: string) => void;
};
