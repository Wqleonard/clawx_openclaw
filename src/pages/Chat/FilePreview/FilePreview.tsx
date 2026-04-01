import { useMemo } from 'react';
import { EmptyPreview } from './EmptyPreview';
import { ImagePreview } from './ImagePreview';
import { MarkdownPreview } from './MarkdownPreview';
import type { FilePreviewProps } from './types';
import { UnsupportedPreview } from './UnsupportedPreview';
import { getPreviewKind } from './utils';

export function FilePreview(props: FilePreviewProps) {
  const { activeFile } = props;
  const previewKind = useMemo(() => getPreviewKind(activeFile), [activeFile]);

  if (previewKind === 'none') {
    return <EmptyPreview />;
  }

  if (previewKind === 'markdown') {
    return (
      <MarkdownPreview
        fileContent={props.fileContent}
        mdViewMode={props.mdViewMode}
        onMdViewModeChange={props.onMdViewModeChange}
        onMarkdownChange={props.onMarkdownChange}
      />
    );
  }

  if (previewKind === 'image' && activeFile) {
    return <ImagePreview activeFile={activeFile} />;
  }

  return <UnsupportedPreview activeFile={activeFile} />;
}
