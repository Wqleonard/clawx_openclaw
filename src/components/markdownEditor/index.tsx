import { useEffect, useRef, useState, type ReactNode } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import type { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import { useTranslation } from 'react-i18next';
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
  ArrowRightLeft,
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
import Mermaid from '../extensions/mermaid/Mermaid';

type MarkdownEditorProps = {
  value: string;
  mode: 'source' | 'rendered';
  onModeChange?: (mode: 'source' | 'rendered') => void;
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

export function MarkdownEditor({ value, mode, onModeChange, onChange, className }: MarkdownEditorProps) {
  const { t } = useTranslation('chat');
  const suppressNextUpdate = useRef(0);
  const onChangeRef = useRef(onChange);
  const skipNextHeadingValueChangeRef = useRef<Exclude<HeadingLevelValue, 'paragraph'> | null>(null);
  const [headingLevel, setHeadingLevel] = useState<HeadingLevelValue>('paragraph');

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const editor = useEditor({
    extensions: [StarterKit, Markdown,Mermaid],
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

  const isSourceMode = mode === 'source';
  const toggleMode = () => {
    onModeChange?.(isSourceMode ? 'rendered' : 'source');
  };

  if (!editor) return null;

  const applyHeadingLevel = (value: HeadingLevelValue) => {
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

  const handleHeadingItemPointerDown =
    (level: Exclude<HeadingLevelValue, 'paragraph'>) =>
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.defaultPrevented) return;
      if (headingLevel === level) {
        event.preventDefault();
        skipNextHeadingValueChangeRef.current = level;
        applyHeadingLevel('paragraph');
      }
    };

  return (
    <div className={cn('flex h-full min-h-0 flex-col overflow-hidden', className)}>
      <TooltipProvider>
        <Toolbar className="shrink-0">
          <ToolbarGroup>
            <ToolbarButton
              tooltip={t('markdownEditor.toolbar.undo')}
              disabled={!editor.can().chain().focus().undo().run() || isSourceMode}
              onClick={() => editor.chain().focus().undo().run()}
            >
              <Undo2 className="h-4 w-4" />
            </ToolbarButton>
            <ToolbarButton
              tooltip={t('markdownEditor.toolbar.redo')}
              disabled={!editor.can().chain().focus().redo().run() || isSourceMode}
              onClick={() => editor.chain().focus().redo().run()}
            >
              <Redo2 className="h-4 w-4" />
            </ToolbarButton>
          </ToolbarGroup>

          <ToolbarSeparator />

          <ToolbarGroup>
            <Select
              value={headingLevel}
              onValueChange={(next) => {
                const value = next as HeadingLevelValue;
                if (skipNextHeadingValueChangeRef.current === value) {
                  skipNextHeadingValueChangeRef.current = null;
                  return;
                }
                applyHeadingLevel(value);
              }}
              disabled={isSourceMode}
            >
              <SelectTrigger
                size="sm"
                className="h-8 gap-1.5 p-0 px-1 border-transparent bg-transparent hover:bg-black/5 dark:hover:bg-white/10"
                aria-label={t('markdownEditor.toolbar.headingLevel')}
              >
                <HeadingLevelIcon level={headingLevel} />
              </SelectTrigger>
              <SelectContent align="start">
                <SelectItem
                  value="h1"
                  onPointerDown={handleHeadingItemPointerDown('h1')}
                >
                  <div className="flex items-center gap-2">
                    <Heading1 className="h-4 w-4" />
                  </div>
                </SelectItem>
                <SelectItem
                  value="h2"
                  onPointerDown={handleHeadingItemPointerDown('h2')}
                >
                  <div className="flex items-center gap-2">
                    <Heading2 className="h-4 w-4" />
                  </div>
                </SelectItem>
                <SelectItem
                  value="h3"
                  onPointerDown={handleHeadingItemPointerDown('h3')}
                >
                  <div className="flex items-center gap-2">
                    <Heading3 className="h-4 w-4" />
                  </div>
                </SelectItem>
                <SelectItem
                  value="h4"
                  onPointerDown={handleHeadingItemPointerDown('h4')}
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
              tooltip={t('markdownEditor.toolbar.bold')}
              active={editor.isActive('bold')}
              onClick={() => editor.chain().focus().toggleBold().run()}
              disabled={isSourceMode}
            >
              <Bold className="h-4 w-4" />
            </ToolbarButton>
            <ToolbarButton
              tooltip={t('markdownEditor.toolbar.italic')}
              active={editor.isActive('italic')}
              onClick={() => editor.chain().focus().toggleItalic().run()}
              disabled={isSourceMode}
            >
              <Italic className="h-4 w-4" />
            </ToolbarButton>
            <ToolbarButton
              tooltip={t('markdownEditor.toolbar.strikethrough')}
              active={editor.isActive('strike')}
              onClick={() => editor.chain().focus().toggleStrike().run()}
              disabled={isSourceMode}
            >
              <Strikethrough className="h-4 w-4" />
            </ToolbarButton>
            <ToolbarButton
              tooltip={t('markdownEditor.toolbar.inlineCode')}
              active={editor.isActive('code')}
              onClick={() => editor.chain().focus().toggleCode().run()}
              disabled={isSourceMode}
            >
              <Code className="h-4 w-4" />
            </ToolbarButton>
          </ToolbarGroup>

          <ToolbarSeparator />

          <ToolbarGroup>
            <ToolbarButton
              tooltip={t('markdownEditor.toolbar.bulletList')}
              active={editor.isActive('bulletList')}
              onClick={() => editor.chain().focus().toggleBulletList().run()}
              disabled={isSourceMode}
            >
              <List className="h-4 w-4" />
            </ToolbarButton>
            <ToolbarButton
              tooltip={t('markdownEditor.toolbar.orderedList')}
              active={editor.isActive('orderedList')}
              onClick={() => editor.chain().focus().toggleOrderedList().run()}
              disabled={isSourceMode}
            >
              <ListOrdered className="h-4 w-4" />
            </ToolbarButton>
            <ToolbarButton
              tooltip={t('markdownEditor.toolbar.blockquote')}
              active={editor.isActive('blockquote')}
              onClick={() => editor.chain().focus().toggleBlockquote().run()}
              disabled={isSourceMode}
            >
              <Quote className="h-4 w-4" />
            </ToolbarButton>
            <ToolbarButton
              tooltip={t('markdownEditor.toolbar.codeBlock')}
              active={editor.isActive('codeBlock')}
              onClick={() => editor.chain().focus().toggleCodeBlock().run()}
              disabled={isSourceMode}
            >
              <CodeXml className="h-4 w-4"/>
            </ToolbarButton>
          </ToolbarGroup>
          <ToolbarGroup>
            <ToolbarButton
              tooltip={
                mode === 'rendered'
                  ? t('markdownEditor.toolbar.switchToSource')
                  : t('markdownEditor.toolbar.switchToRendered')
              }
              onClick={toggleMode}
              active={isSourceMode}
            >
              <ArrowRightLeft className="h-4 w-4" />
            </ToolbarButton>
          </ToolbarGroup>
        </Toolbar>
      </TooltipProvider>


      {
        isSourceMode ? (
          <textarea
          className="h-full w-full flex-1 resize-none border-0 bg-transparent p-4 font-mono text-base leading-6 text-foreground outline-none"
          value={value}
          onChange={(event) => onChangeRef.current?.(event.target.value)}
          spellCheck={false}
        />
        ) : (
          <div className="min-h-0 flex-1 overflow-auto">
            <EditorContent editor={editor} className="h-full" />
          </div>
        )
      }
    </div>
  );
}
