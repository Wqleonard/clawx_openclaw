/**
 * Chat Page
 * Native React implementation communicating with OpenClaw Gateway
 * via gateway:rpc IPC. Session selector, thinking toggle, and refresh
 * are in the toolbar; messages render with markdown + streaming.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Loader2, Sparkles } from 'lucide-react';
import { useChatStore, type RawMessage } from '@/stores/chat';
import { useGatewayStore } from '@/stores/gateway';
import { useAgentsStore } from '@/stores/agents';
import { useFileSystemStore } from '@/stores/filesystem';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { ChatMessage } from './ChatMessage';
import { ChatInput } from './ChatInput';
import { ChatToolbar } from './ChatToolbar';
import { extractImages, extractText, extractThinking, extractToolUse } from './message-utils';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { useStickToBottomInstant } from '@/hooks/use-stick-to-bottom-instant';
import { useMinLoading } from '@/hooks/use-min-loading';
import { Drawer, DrawerContent } from '@/components/ui/drawer';
import { useChatLayoutStore } from '@/stores/chat-layout';

import { FileTabs, FileTree } from '@/components/filesystem';
import { MarkdownEditor } from '@/components/markdownEditor';

const EDITOR_MIN_WIDTH = 260;
const EDITOR_MAX_WIDTH = 900;
const EDITOR_DEFAULT_WIDTH = 560;
const CHAT_MIN_WIDTH = 420;

function isMarkdownFile(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  return lower.endsWith('.md') || lower.endsWith('.markdown') || lower.endsWith('.mdx');
}

export function Chat() {
  const { t } = useTranslation('chat');
  const [mdViewMode, setMdViewMode] = useState<'source' | 'rendered'>('rendered');
  const [editorWidth, setEditorWidth] = useState(EDITOR_DEFAULT_WIDTH);
  const isDragging = useRef(false);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const gatewayStatus = useGatewayStore((s) => s.status);
  const isGatewayRunning = gatewayStatus.state === 'running';

  const messages = useChatStore((s) => s.messages);
  const currentSessionKey = useChatStore((s) => s.currentSessionKey);
  const loading = useChatStore((s) => s.loading);
  const sending = useChatStore((s) => s.sending);
  const error = useChatStore((s) => s.error);
  const showThinking = useChatStore((s) => s.showThinking);
  const streamingMessage = useChatStore((s) => s.streamingMessage);
  const streamingTools = useChatStore((s) => s.streamingTools);
  const pendingFinal = useChatStore((s) => s.pendingFinal);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const abortRun = useChatStore((s) => s.abortRun);
  const clearError = useChatStore((s) => s.clearError);
  const fetchAgents = useAgentsStore((s) => s.fetchAgents);

  const cleanupEmptySession = useChatStore((s) => s.cleanupEmptySession);
  const activeFile = useFileSystemStore((s) => s.activeFile);
  const openFiles = useFileSystemStore((s) => s.openFiles);
  const fileContents = useFileSystemStore((s) => s.fileContents);
  const dirtyFiles = useFileSystemStore((s) => s.dirtyFiles);
  const setActiveFile = useFileSystemStore((s) => s.setActiveFile);
  const closeFile = useFileSystemStore((s) => s.closeFile);
  const applyWorkspaceForSession = useFileSystemStore((s) => s.applyWorkspaceForSession);
  const updateFileContent = useFileSystemStore((s) => s.updateFileContent);
  const saveFile = useFileSystemStore((s) => s.saveFile);
  const isFileTreeDrawerOpen = useChatLayoutStore((s) => s.isFileTreeDrawerOpen);
  const setFileTreeDrawerOpen = useChatLayoutStore((s) => s.setFileTreeDrawerOpen);
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [streamingTimestamp, setStreamingTimestamp] = useState<number>(0);
  const minLoading = useMinLoading(loading && messages.length > 0);
  const { contentRef, scrollRef } = useStickToBottomInstant(currentSessionKey);

  // Load data when gateway is running.
  // When the store already holds messages for this session (i.e. the user
  // is navigating *back* to Chat), use quiet mode so the existing messages
  // stay visible while fresh data loads in the background.  This avoids
  // an unnecessary messages → spinner → messages flicker.
  useEffect(() => {
    return () => {
      // If the user navigates away without sending any messages, remove the
      // empty session so it doesn't linger as a ghost entry in the sidebar.
      cleanupEmptySession();
    };
  }, [cleanupEmptySession]);

  useEffect(() => {
    void fetchAgents();
  }, [fetchAgents]);

  useEffect(() => {
    void applyWorkspaceForSession(currentSessionKey);
  }, [currentSessionKey, applyWorkspaceForSession]);

  // Update timestamp when sending starts
  useEffect(() => {
    if (sending && streamingTimestamp === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStreamingTimestamp(Date.now() / 1000);
    } else if (!sending && streamingTimestamp !== 0) {
      setStreamingTimestamp(0);
    }
  }, [sending, streamingTimestamp]);

  // Gateway not running block has been completely removed so the UI always renders.

  const streamMsg =
    streamingMessage && typeof streamingMessage === 'object'
      ? (streamingMessage as unknown as { role?: string; content?: unknown; timestamp?: number })
      : null;
  const streamText = streamMsg
    ? extractText(streamMsg)
    : typeof streamingMessage === 'string'
      ? streamingMessage
      : '';
  const hasStreamText = streamText.trim().length > 0;
  const streamThinking = streamMsg ? extractThinking(streamMsg) : null;
  const hasStreamThinking = showThinking && !!streamThinking && streamThinking.trim().length > 0;
  const streamTools = streamMsg ? extractToolUse(streamMsg) : [];
  const hasStreamTools = streamTools.length > 0;
  const streamImages = streamMsg ? extractImages(streamMsg) : [];
  const hasStreamImages = streamImages.length > 0;
  const hasStreamToolStatus = streamingTools.length > 0;
  const shouldRenderStreaming =
    sending &&
    (hasStreamText ||
      hasStreamThinking ||
      hasStreamTools ||
      hasStreamImages ||
      hasStreamToolStatus);
  const hasAnyStreamContent =
    hasStreamText || hasStreamThinking || hasStreamTools || hasStreamImages || hasStreamToolStatus;

  const isEmpty = messages.length === 0 && !sending;
  const markdownOpenFiles = useMemo(
    () => openFiles.filter((filePath) => isMarkdownFile(filePath)),
    [openFiles]
  );
  const activeMarkdownFile = useMemo(() => {
    if (activeFile && isMarkdownFile(activeFile)) {
      return activeFile;
    }
    return markdownOpenFiles[markdownOpenFiles.length - 1] ?? null;
  }, [activeFile, markdownOpenFiles]);
  const activeMarkdownContent = activeMarkdownFile ? (fileContents[activeMarkdownFile] ?? '') : '';
  const markdownDirtyFiles = useMemo(
    () => dirtyFiles.filter((filePath) => isMarkdownFile(filePath)),
    [dirtyFiles]
  );
  const handleMarkdownChange = useCallback(
    (nextMarkdown: string) => {
      if (!activeMarkdownFile) return;
      updateFileContent(activeMarkdownFile, nextMarkdown);
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }
      autoSaveTimerRef.current = setTimeout(() => {
        void saveFile(activeMarkdownFile);
      }, 200);
    },
    [activeMarkdownFile, saveFile, updateFileContent]
  );

  useEffect(() => {
    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }
    };
  }, []);

  const handleImportToEditor = useCallback(
    (content: string) => {
      if (activeFile) {
        updateFileContent(activeFile, content);
      }
    },
    [activeFile, updateFileContent]
  );

  // Drag-to-resize editor while preserving chat page behavior from main branch.
  const onDragStart = useCallback(
    (e: React.MouseEvent) => {
      isDragging.current = true;
      dragStartX.current = e.clientX;
      dragStartWidth.current = editorWidth;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';

      const onMove = (ev: MouseEvent) => {
        if (!isDragging.current) return;
        const delta = ev.clientX - dragStartX.current;
        const containerWidth = containerRef.current?.clientWidth ?? window.innerWidth;
        const maxByContainer = Math.max(EDITOR_MIN_WIDTH, containerWidth - CHAT_MIN_WIDTH);
        const dynamicMaxWidth = Math.min(EDITOR_MAX_WIDTH, maxByContainer);
        const next = Math.min(
          dynamicMaxWidth,
          Math.max(EDITOR_MIN_WIDTH, dragStartWidth.current - delta)
        );
        setEditorWidth(next);
      };
      const onUp = () => {
        isDragging.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [editorWidth]
  );

  return (
    <div
      ref={containerRef}
      className={cn('flex h-full transition-colors duration-500 dark:bg-background')}
    >
      {/* Chat Panel */}
      <div className="relative flex flex-1 flex-col overflow-hidden">
        {/* Toolbar */}
        <div className="flex shrink-0 items-center justify-end px-4 py-2">
          <ChatToolbar />
        </div>

        {/* Messages Area */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4">
          <div ref={contentRef} className="max-w-4xl mx-auto space-y-4">
            {isEmpty ? (
              <WelcomeScreen />
            ) : (
              <>
                {messages.map((msg, idx) => (
                  <ChatMessage
                    key={msg.id || `msg-${idx}`}
                    message={msg}
                    showThinking={showThinking}
                    onImportToEditor={handleImportToEditor}
                  />
                ))}

                {/* Streaming message */}
                {shouldRenderStreaming && (
                  <ChatMessage
                    message={
                      (streamMsg
                        ? {
                            ...(streamMsg as Record<string, unknown>),
                            role: (typeof streamMsg.role === 'string'
                              ? streamMsg.role
                              : 'assistant') as RawMessage['role'],
                            content: streamMsg.content ?? streamText,
                            timestamp: streamMsg.timestamp ?? streamingTimestamp,
                          }
                        : {
                            role: 'assistant',
                            content: streamText,
                            timestamp: streamingTimestamp,
                          }) as RawMessage
                    }
                    showThinking={showThinking}
                    isStreaming
                    streamingTools={streamingTools}
                    onImportToEditor={handleImportToEditor}
                  />
                )}

                {/* Activity indicator */}
                {sending && pendingFinal && !shouldRenderStreaming && (
                  <ActivityIndicator phase="tool_processing" />
                )}

                {/* Typing indicator */}
                {sending && !pendingFinal && !hasAnyStreamContent && <TypingIndicator />}
              </>
            )}
          </div>
        </div>

        {/* Error bar */}
        {error && (
          <div className="px-4 py-2 bg-destructive/10 border-t border-destructive/20">
            <div className="max-w-2xl mx-auto flex items-center justify-between">
              <p className="text-sm text-destructive flex items-center gap-2">
                <AlertCircle className="h-4 w-4" />
                {error}
              </p>
              <button
                onClick={clearError}
                className="text-xs text-destructive/60 hover:text-destructive underline"
              >
                {t('common:actions.dismiss')}
              </button>
            </div>
          </div>
        )}

        {/* Input Area */}
        <ChatInput
          onSend={sendMessage}
          onStop={abortRun}
          disabled={!isGatewayRunning}
          sending={sending}
          isEmpty={isEmpty}
        />
        {/* Transparent loading overlay */}
        {minLoading && !sending && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/20 backdrop-blur-[1px] rounded-xl pointer-events-auto">
            <div className="bg-background shadow-lg rounded-full p-2.5 border border-border">
              <LoadingSpinner size="md" />
            </div>
          </div>
        )}
      </div>

      <div
          onMouseDown={onDragStart}
          className="w-1 h-full cursor-col-resize -mr-0.5 z-9"
          title="拖动调整宽度"
        >
        </div>

      {/* Markdown Viewer Panel */}
      <div
        className="group relative border-l flex shrink-0 overflow-hidden"
        style={{ width: editorWidth }}
      >
        
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden border-r border-border">
          <FileTabs
            openFiles={markdownOpenFiles}
            activeFile={activeMarkdownFile}
            dirtyFiles={markdownDirtyFiles}
            onSelectFile={setActiveFile}
            onCloseFile={closeFile}
          />

          <div className="min-h-0 flex-1 overflow-hidden">
            {!activeMarkdownFile ? (
              <div className="flex h-full items-center justify-center px-4 text-center text-sm text-muted-foreground">
                点击文件树中的 `.md` 文件后，会在这里新增标签页并显示内容
              </div>
            ) : (
              <div className="w-full h-full">
                <div className="w-full flex items-center justify-end gap-1 px-4 py-1">
                  <div>
                  <button
                    type="button"
                    onClick={() => setMdViewMode('source')}
                    className={cn(
                      'rounded px-2 py-1 text-xs transition-colors',
                      mdViewMode === 'source'
                        ? 'bg-muted text-foreground'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                    )}
                    title="切换到源码视图"
                  >
                    源码
                  </button>
                  <button
                    type="button"
                    onClick={() => setMdViewMode('rendered')}
                    className={cn(
                      'rounded px-2 py-1 text-xs transition-colors',
                      mdViewMode === 'rendered'
                        ? 'bg-muted text-foreground'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                    )}
                    title="切换到渲染视图"
                  >
                    渲染
                  </button>
                  </div>
                </div>
                <MarkdownEditor
                  className="h-full"
                  value={activeMarkdownContent}
                  mode={mdViewMode}
                  onChange={handleMarkdownChange}
                />
              </div>
            )}
          </div>
        </div>
      </div>

      <Drawer
        direction="right"
        open={isFileTreeDrawerOpen}
        onOpenChange={setFileTreeDrawerOpen}
        shouldScaleBackground={false}
      >
        <DrawerContent
          hideOverlay
          className="border-l border-t border-border p-0 data-[vaul-drawer-direction=right]:w-[260px] data-[vaul-drawer-direction=right]:max-w-[260px] data-[vaul-drawer-direction=right]:rounded-none data-[vaul-drawer-direction=right]:top-10 data-[vaul-drawer-direction=right]:bottom-0"
        >
          <FileTree className="h-full" />
        </DrawerContent>
      </Drawer>
    </div>
  );
}

// ── Welcome Screen ──────────────────────────────────────────────

function WelcomeScreen() {
  const { t } = useTranslation('chat');
  const quickActions = [
    { key: 'askQuestions', label: t('welcome.askQuestions') },
    { key: 'creativeTasks', label: t('welcome.creativeTasks') },
    { key: 'brainstorming', label: t('welcome.brainstorming') },
  ];

  return (
    <div className="flex flex-col items-center justify-center text-center h-[60vh]">
      <h1
        className="text-4xl md:text-5xl font-serif text-foreground/80 mb-8 font-normal tracking-tight"
        style={{ fontFamily: 'Georgia, Cambria, "Times New Roman", Times, serif' }}
      >
        {t('welcome.subtitle')}
      </h1>

      <div className="flex flex-wrap items-center justify-center gap-2.5 max-w-lg w-full">
        {quickActions.map(({ key, label }) => (
          <button
            key={key}
            className="px-4 py-1.5 rounded-full border border-black/10 dark:border-white/10 text-[13px] font-medium text-foreground/70 hover:bg-black/5 dark:hover:bg-white/5 transition-colors bg-black/[0.02]"
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Typing Indicator ────────────────────────────────────────────

function TypingIndicator() {
  return (
    <div className="flex gap-3">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full mt-1 bg-black/5 dark:bg-white/5 text-foreground">
        <Sparkles className="h-4 w-4" />
      </div>
      <div className="bg-black/5 dark:bg-white/5 text-foreground rounded-2xl px-4 py-3">
        <div className="flex gap-1">
          <span
            className="w-2 h-2 bg-muted-foreground/50 rounded-full animate-bounce"
            style={{ animationDelay: '0ms' }}
          />
          <span
            className="w-2 h-2 bg-muted-foreground/50 rounded-full animate-bounce"
            style={{ animationDelay: '150ms' }}
          />
          <span
            className="w-2 h-2 bg-muted-foreground/50 rounded-full animate-bounce"
            style={{ animationDelay: '300ms' }}
          />
        </div>
      </div>
    </div>
  );
}

// ── Activity Indicator (shown between tool cycles) ─────────────

function ActivityIndicator({ phase }: { phase: 'tool_processing' }) {
  void phase;
  return (
    <div className="flex gap-3">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full mt-1 bg-black/5 dark:bg-white/5 text-foreground">
        <Sparkles className="h-4 w-4" />
      </div>
      <div className="bg-black/5 dark:bg-white/5 text-foreground rounded-2xl px-4 py-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
          <span>Processing tool results…</span>
        </div>
      </div>
    </div>
  );
}

export default Chat;
