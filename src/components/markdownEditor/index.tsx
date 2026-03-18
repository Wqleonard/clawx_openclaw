import { useEffect, useRef, useState, type ReactNode } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import type { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Toolbar, ToolbarGroup, ToolbarSeparator } from '@/components/tiptap-ui-primitive/toolbar';
import { cn } from '@/lib/utils';
import {
  Bold,
  Code,
  CodeXml,
  Heading,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Italic,
  List,
  ListOrdered,
  Quote,
  Redo2,
  Strikethrough,
  Undo2,
} from 'lucide-react';

type MarkdownEditorProps = {
  value: string;
  mode: 'source' | 'rendered';
  onChange?: (markdown: string) => void;
  className?: string;
};

type HeadingLevelValue = 'paragraph' | 'h1' | 'h2' | 'h3' | 'h4';

type ToolbarButtonProps = {
  tooltip: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
};

function ToolbarButton({
  tooltip,
  active = false,
  disabled = false,
  onClick,
  children,
}: ToolbarButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={disabled}
          onClick={onClick}
          className={cn(
            'h-8 w-8',
            active ? 'bg-black/5 dark:bg-white/10 ' : 'text-muted-foreground'
          )}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
}

function HeadingLevelIcon({ level }: { level: HeadingLevelValue }) {
  if (level === 'h1') return <Heading1 className="h-4 w-4" />;
  if (level === 'h2') return <Heading2 className="h-4 w-4" />;
  if (level === 'h3') return <Heading3 className="h-4 w-4" />;
  if (level === 'h4') return <Heading4 className="h-4 w-4" />;
  return <Heading className="h-4 w-4" />;
}

export function MarkdownEditor({ value, mode, onChange, className }: MarkdownEditorProps) {
  const suppressNextUpdate = useRef(0);
  const onChangeRef = useRef(onChange);
  const [headingLevel, setHeadingLevel] = useState<HeadingLevelValue>('paragraph');

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const editor = useEditor({
    extensions: [StarterKit, Markdown],
    content: value,
    contentType: 'markdown',
    editable: mode === 'rendered',
    editorProps: {
      attributes: {
        class:
          'prose prose-sm dark:prose-invert max-w-none min-h-full px-4 py-3 focus:outline-none selection:bg-primary/30 dark:selection:bg-primary/40',
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
    editor.commands.setContent(value, { contentType: 'markdown' } as Parameters<
      typeof editor.commands.setContent
    >[1]);
  }, [editor, value]);

  useEffect(() => {
    if (!editor) return;
    editor.setEditable(mode === 'rendered');
  }, [editor, mode]);

  useEffect(() => {
    if (!editor) return;

    const computeHeadingValue = (): HeadingLevelValue => {
      if (editor.isActive('heading', { level: 1 })) return 'h1';
      if (editor.isActive('heading', { level: 2 })) return 'h2';
      if (editor.isActive('heading', { level: 3 })) return 'h3';
      if (editor.isActive('heading', { level: 4 })) return 'h4';
      return 'paragraph';
    };

    const syncHeadingValue = () => {
      setHeadingLevel(computeHeadingValue());
    };

    syncHeadingValue();
    editor.on('selectionUpdate', syncHeadingValue);
    editor.on('transaction', syncHeadingValue);

    return () => {
      editor.off('selectionUpdate', syncHeadingValue);
      editor.off('transaction', syncHeadingValue);
    };
  }, [editor]);

  if (mode === 'source') {
    return (
      <textarea
        className={cn(
          'h-full w-full resize-none border-0 bg-transparent p-4 font-mono text-base leading-6 text-foreground outline-none',
          className
        )}
        value={value}
        onChange={(event) => onChangeRef.current?.(event.target.value)}
        spellCheck={false}
      />
    );
  }

  if (!editor) return null;

  const applyHeadingLevel = (value: HeadingLevelValue) => {
    console.log('applyHeadingLevel', value);
    if (value === 'paragraph') {
      editor.chain().focus().setParagraph().run();
      return;
    }
    const levelMap: Record<Exclude<HeadingLevelValue, 'paragraph'>, 1 | 2 | 3 | 4> = {
      h1: 1,
      h2: 2,
      h3: 3,
      h4: 4,
    };
    editor.chain().focus().setHeading({ level: levelMap[value] }).run();
  };

  const handleHeadingItemClick =
    (level: Exclude<HeadingLevelValue, 'paragraph'>) =>
    (event: React.MouseEvent<HTMLDivElement>) => {
      console.log('handleHeadingItemClick', level);
      if (event.defaultPrevented) return;
      if (headingLevel === level) {
        event.preventDefault();
        applyHeadingLevel('paragraph');
      }
    };

  return (
    <div className={cn('flex h-full min-h-0 flex-col overflow-hidden', className)}>
      <TooltipProvider>
        <Toolbar className="shrink-0">
          <ToolbarGroup>
            <ToolbarButton
              tooltip="撤销"
              disabled={!editor.can().chain().focus().undo().run()}
              onClick={() => editor.chain().focus().undo().run()}
            >
              <Undo2 className="h-4 w-4" />
            </ToolbarButton>
            <ToolbarButton
              tooltip="重做"
              disabled={!editor.can().chain().focus().redo().run()}
              onClick={() => editor.chain().focus().redo().run()}
            >
              <Redo2 className="h-4 w-4" />
            </ToolbarButton>
          </ToolbarGroup>

          <ToolbarSeparator />

          <ToolbarGroup>
            <Select
              value={headingLevel === 'paragraph' ? undefined : headingLevel}
              onValueChange={(next) => {
                const value = next as Exclude<HeadingLevelValue, 'paragraph'>;
                applyHeadingLevel(value);
              }}
            >
              <SelectTrigger
                size="sm"
                className="h-8 gap-1.5 p-0 px-1 border-transparent bg-transparent hover:bg-black/5 dark:hover:bg-white/10"
                aria-label="标题级别"
              >
                <HeadingLevelIcon level={headingLevel} />
              </SelectTrigger>
              <SelectContent align="start">
                <SelectItem
                  value="h1"
                  onClick={handleHeadingItemClick('h1')}
                >
                  <div className="flex items-center gap-2">
                    <Heading1 className="h-4 w-4" />
                  </div>
                </SelectItem>
                <SelectItem
                  value="h2"
                  onClick={handleHeadingItemClick('h2')}
                >
                  <div className="flex items-center gap-2">
                    <Heading2 className="h-4 w-4" />
                  </div>
                </SelectItem>
                <SelectItem
                  value="h3"
                  onClick={handleHeadingItemClick('h3')}
                >
                  <div className="flex items-center gap-2">
                    <Heading3 className="h-4 w-4" />
                  </div>
                </SelectItem>
                <SelectItem
                  value="h4"
                  onClick={handleHeadingItemClick('h4')}
                >
                  <div className="flex items-center gap-2">
                    <Heading4 className="h-4 w-4" />
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
          </ToolbarGroup>

          <ToolbarSeparator />

          <ToolbarGroup>
            <ToolbarButton
              tooltip="粗体"
              active={editor.isActive('bold')}
              onClick={() => editor.chain().focus().toggleBold().run()}
            >
              <Bold className="h-4 w-4" />
            </ToolbarButton>
            <ToolbarButton
              tooltip="斜体"
              active={editor.isActive('italic')}
              onClick={() => editor.chain().focus().toggleItalic().run()}
            >
              <Italic className="h-4 w-4" />
            </ToolbarButton>
            <ToolbarButton
              tooltip="删除线"
              active={editor.isActive('strike')}
              onClick={() => editor.chain().focus().toggleStrike().run()}
            >
              <Strikethrough className="h-4 w-4" />
            </ToolbarButton>
            <ToolbarButton
              tooltip="行内代码"
              active={editor.isActive('code')}
              onClick={() => editor.chain().focus().toggleCode().run()}
            >
              <Code className="h-4 w-4" />
            </ToolbarButton>
          </ToolbarGroup>

          <ToolbarSeparator />

          <ToolbarGroup>
            <ToolbarButton
              tooltip="无序列表"
              active={editor.isActive('bulletList')}
              onClick={() => editor.chain().focus().toggleBulletList().run()}
            >
              <List className="h-4 w-4" />
            </ToolbarButton>
            <ToolbarButton
              tooltip="有序列表"
              active={editor.isActive('orderedList')}
              onClick={() => editor.chain().focus().toggleOrderedList().run()}
            >
              <ListOrdered className="h-4 w-4" />
            </ToolbarButton>
            <ToolbarButton
              tooltip="引用"
              active={editor.isActive('blockquote')}
              onClick={() => editor.chain().focus().toggleBlockquote().run()}
            >
              <Quote className="h-4 w-4" />
            </ToolbarButton>
            <ToolbarButton
              tooltip="代码块"
              active={editor.isActive('codeBlock')}
              onClick={() => editor.chain().focus().toggleCodeBlock().run()}
            >
              <CodeXml className="h-4 w-4"/>
            </ToolbarButton>
          </ToolbarGroup>
        </Toolbar>
      </TooltipProvider>

      <div className="min-h-0 flex-1 overflow-auto">
        <EditorContent editor={editor} className="h-full" />
      </div>
    </div>
  );
}
