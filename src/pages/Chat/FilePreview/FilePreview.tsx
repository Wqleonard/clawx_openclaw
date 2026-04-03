import { useMemo } from 'react';
import { DocPreview } from './DocPreview';
import { EmptyPreview } from './EmptyPreview';
import { ImagePreview } from './ImagePreview';
import { MarkdownPreview } from './MarkdownPreview';
import { PdfPreview } from './PdfPreview';
import { PptPreview } from './PptPreview';
import { TextPreview } from './TextPreview';
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

  if (previewKind === 'text' && activeFile) {
    return (
      <TextPreview
        activeFile={activeFile}
        fileContent={props.fileContent}
        onTextChange={props.onMarkdownChange}
      />
    );
  }

  if (previewKind === 'pdf' && activeFile) {
    return <PdfPreview activeFile={activeFile} />;
  }

  if (previewKind === 'document' && activeFile) {
    return <DocPreview activeFile={activeFile} />;
  }

  if (previewKind === 'presentation' && activeFile) {
    return <PptPreview key={activeFile} activeFile={activeFile} />;
  }

  return <UnsupportedPreview activeFile={activeFile} />;
}
