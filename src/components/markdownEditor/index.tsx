import { useEffect, useRef } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import type { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import { cn } from '@/lib/utils';

type MarkdownEditorProps = {
  value: string;
  mode: 'source' | 'rendered';
  onChange?: (markdown: string) => void;
  className?: string;
};

export function MarkdownEditor({
  value,
  mode,
  onChange,
  className,
}: MarkdownEditorProps) {
  const suppressNextUpdate = useRef(0);
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const editor = useEditor({
    extensions: [StarterKit, Markdown],
    content: value,
    contentType: 'markdown',
    editable: false,
    editorProps: {
      attributes: {
        class: 'prose prose-sm dark:prose-invert max-w-none min-h-full px-4 py-3 focus:outline-none',
      },
    },
    onUpdate({ editor: currentEditor, transaction }) {
      if (!transaction.docChanged) return;
      if (suppressNextUpdate.current > 0) {
        suppressNextUpdate.current -= 1;
        return;
      }
      const md = (currentEditor as Editor & { getMarkdown?: () => string }).getMarkdown?.() ?? '';
      onChangeRef.current?.(md);
    },
  });

  useEffect(() => {
    if (!editor) return;
    const current = (editor as Editor & { getMarkdown?: () => string }).getMarkdown?.() ?? '';
    if (current === value) return;
    suppressNextUpdate.current += 1;
    editor.commands.setContent(
      value,
      { contentType: 'markdown' } as Parameters<typeof editor.commands.setContent>[1],
    );
  }, [editor, value]);

  if (mode === 'source') {
    return (
      <textarea
        className={cn(
          'h-full w-full resize-none border-0 bg-transparent p-4 font-mono text-[12px] leading-6 text-foreground outline-none',
          className,
        )}
        value={value}
        onChange={(event) => onChangeRef.current?.(event.target.value)}
        spellCheck={false}
      />
    );
  }

  if (!editor) return null;

  return (
    <div className={cn('h-full overflow-auto', className)}>
      <EditorContent editor={editor} className="h-full" />
    </div>
  );
}

