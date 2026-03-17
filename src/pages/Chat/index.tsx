/**
 * Chat Page
 * Native React implementation communicating with OpenClaw Gateway
 * via gateway:rpc IPC. Session selector, thinking toggle, and refresh
 * are in the toolbar; messages render with markdown + streaming.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Loader2, Plus, Sparkles, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
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
import { useChatLayoutStore } from '@/stores/chat-layout';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

import { FileTabs, FileTree } from '@/components/filesystem';
import { MarkdownEditor } from '@/components/markdownEditor';

const EDITOR_MIN_WIDTH = 260;
const EDITOR_MAX_WIDTH = 900;
const EDITOR_DEFAULT_WIDTH = 560;
const LIST_MIN_WIDTH = 220;
const LIST_MAX_WIDTH = 520;
const LIST_DEFAULT_WIDTH = 280;
const CHAT_MIN_WIDTH = 420;
const INITIAL_NOW_MS = Date.now();

type SessionBucketKey =
  | 'today'
  | 'yesterday'
  | 'withinWeek'
  | 'withinTwoWeeks'
  | 'withinMonth'
  | 'older';

function getSessionBucket(activityMs: number, nowMs: number): SessionBucketKey {
  if (!activityMs || activityMs <= 0) return 'older';

  const now = new Date(nowMs);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 24 * 60 * 60 * 1000;

  if (activityMs >= startOfToday) return 'today';
  if (activityMs >= startOfYesterday) return 'yesterday';

  const daysAgo = (startOfToday - activityMs) / (24 * 60 * 60 * 1000);
  if (daysAgo <= 7) return 'withinWeek';
  if (daysAgo <= 14) return 'withinTwoWeeks';
  if (daysAgo <= 30) return 'withinMonth';
  return 'older';
}

function getAgentIdFromSessionKey(sessionKey: string): string {
  if (!sessionKey.startsWith('agent:')) return 'main';
  const [, agentId] = sessionKey.split(':');
  return agentId || 'main';
}

function isMarkdownFile(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  return lower.endsWith('.md') || lower.endsWith('.markdown') || lower.endsWith('.mdx');
}

export function Chat() {
  const { t } = useTranslation('chat');
  const navigate = useNavigate();
  const [mdViewMode, setMdViewMode] = useState<'source' | 'rendered'>('rendered');
  const [listWidth, setListWidth] = useState(LIST_DEFAULT_WIDTH);
  const [editorWidth, setEditorWidth] = useState(EDITOR_DEFAULT_WIDTH);
  const isListDragging = useRef(false);
  const listDragStartX = useRef(0);
  const listDragStartWidth = useRef(0);
  const isEditorDragging = useRef(false);
  const editorDragStartX = useRef(0);
  const editorDragStartWidth = useRef(0);
  const initTaskVersionRef = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const gatewayStatus = useGatewayStore((s) => s.status);
  const isGatewayRunning = gatewayStatus.state === 'running';

  const messages = useChatStore((s) => s.messages);
  const sessions = useChatStore((s) => s.sessions);
  const currentSessionKey = useChatStore((s) => s.currentSessionKey);
  const sessionLabels = useChatStore((s) => s.sessionLabels);
  const sessionLastActivity = useChatStore((s) => s.sessionLastActivity);
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
  const switchSession = useChatStore((s) => s.switchSession);
  const newSession = useChatStore((s) => s.newSession);
  const deleteSession = useChatStore((s) => s.deleteSession);
  const loadSessions = useChatStore((s) => s.loadSessions);
  const loadHistory = useChatStore((s) => s.loadHistory);
  const fetchAgents = useAgentsStore((s) => s.fetchAgents);
  const agents = useAgentsStore((s) => s.agents);

  const cleanupEmptySession = useChatStore((s) => s.cleanupEmptySession);
  const workspacePath = useFileSystemStore((s) => s.projectPath);
  const bindProjectToSession = useFileSystemStore((s) => s.bindProjectToSession);
  const projectBindings = useFileSystemStore((s) => s.projectBindings);
  const activeFile = useFileSystemStore((s) => s.activeFile);
  const openFiles = useFileSystemStore((s) => s.openFiles);
  const fileContents = useFileSystemStore((s) => s.fileContents);
  const dirtyFiles = useFileSystemStore((s) => s.dirtyFiles);
  const setActiveFile = useFileSystemStore((s) => s.setActiveFile);
  const closeFile = useFileSystemStore((s) => s.closeFile);
  const applyProjectForSession = useFileSystemStore((s) => s.applyProjectForSession);
  const updateFileContent = useFileSystemStore((s) => s.updateFileContent);
  const saveFile = useFileSystemStore((s) => s.saveFile);
  const isFileTreeDrawerOpen = useChatLayoutStore((s) => s.isFileTreeDrawerOpen);
  const isSessionListCollapsed = useChatLayoutStore((s) => s.isSessionListCollapsed);
  const setProjectSwitching = useChatLayoutStore((s) => s.setProjectSwitching);
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [sessionToDelete, setSessionToDelete] = useState<{ key: string; label: string } | null>(null);
  const [nowMs, setNowMs] = useState(INITIAL_NOW_MS);

  const [streamingTimestamp, setStreamingTimestamp] = useState<number>(0);
  const minLoading = useMinLoading(loading && messages.length > 0);
  const { contentRef, scrollRef } = useStickToBottomInstant(currentSessionKey);
  const resetChatRuntimeState = useCallback(() => {
    useChatStore.setState({
      messages: [],
      loading: false,
      sending: false,
      error: null,
      streamingText: '',
      streamingMessage: null,
      streamingTools: [],
      pendingFinal: false,
      activeRunId: null,
      lastUserMessageAt: null,
      pendingToolImages: [],
    });
  }, []);

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
    if (workspacePath) return;
    initTaskVersionRef.current += 1;
    setProjectSwitching(false);
    resetChatRuntimeState();
  }, [workspacePath, resetChatRuntimeState, setProjectSwitching]);

  useEffect(() => {
    if (!isGatewayRunning) {
      setProjectSwitching(false);
      return;
    }
    const version = ++initTaskVersionRef.current;
    const controller = new AbortController();
    const isTaskAborted = () => controller.signal.aborted || version !== initTaskVersionRef.current;
    setProjectSwitching(true);

    (async () => {
      try {
        if (!workspacePath) {
          if (isTaskAborted()) return;
          resetChatRuntimeState();
          return;
        }

        // 1) Initialize sessions after current project is known.
        await loadSessions();
        if (isTaskAborted()) return;

        const chatState = useChatStore.getState();
        const fsState = useFileSystemStore.getState();
        // 2/3) Derive project sessions (source used by sessionBuckets) from current project.
        const targetSessions = [...chatState.sessions]
          .filter((session) => fsState.projectBindings[session.key] === workspacePath)
          .sort((a, b) => (chatState.sessionLastActivity[b.key] ?? 0) - (chatState.sessionLastActivity[a.key] ?? 0));

        // 4) If project has bound sessions, activate and load the first one.
        if (targetSessions.length > 0) {
          const firstSessionKey = targetSessions[0].key;
          if (firstSessionKey !== chatState.currentSessionKey) {
            if (isTaskAborted()) return;
            switchSession(firstSessionKey);
            return;
          }
          const hasExistingMessages = chatState.messages.length > 0;
          await loadHistory(hasExistingMessages);
          if (isTaskAborted()) return;
          return;
        }

        // 5) No bound sessions: create one and bind it to current project.
        if (isTaskAborted()) return;
        newSession();
        if (isTaskAborted()) return;
        const newSessionKey = useChatStore.getState().currentSessionKey;
        if (newSessionKey) {
          await bindProjectToSession(newSessionKey, workspacePath);
          if (isTaskAborted()) return;
        }
      } finally {
        if (!controller.signal.aborted && version === initTaskVersionRef.current) {
          setProjectSwitching(false);
        }
      }
    })();
    return () => {
      controller.abort();
    };
  }, [
    isGatewayRunning,
    workspacePath,
    loadSessions,
    switchSession,
    loadHistory,
    newSession,
    bindProjectToSession,
    resetChatRuntimeState,
    setProjectSwitching,
  ]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 60 * 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    void applyProjectForSession(currentSessionKey);
  }, [currentSessionKey, applyProjectForSession]);

  // Update timestamp when sending starts
  useEffect(() => {
    if (sending && streamingTimestamp === 0) {
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
  const getSessionLabel = useCallback(
    (key: string, displayName?: string, label?: string) => sessionLabels[key] ?? label ?? displayName ?? key,
    [sessionLabels],
  );
  const agentNameById = useMemo(
    () => Object.fromEntries(agents.map((agent) => [agent.id, agent.name])),
    [agents],
  );
  const projectSessions = useMemo(() => {
    if (!workspacePath) return [];
    return sessions.filter((session) => projectBindings[session.key] === workspacePath);
  }, [workspacePath, sessions, projectBindings]);
  const sessionBuckets: Array<{ key: SessionBucketKey; label: string; sessions: typeof sessions }> = useMemo(() => {
    const buckets: Array<{ key: SessionBucketKey; label: string; sessions: typeof sessions }> = [
      { key: 'today', label: t('historyBuckets.today'), sessions: [] },
      { key: 'yesterday', label: t('historyBuckets.yesterday'), sessions: [] },
      { key: 'withinWeek', label: t('historyBuckets.withinWeek'), sessions: [] },
      { key: 'withinTwoWeeks', label: t('historyBuckets.withinTwoWeeks'), sessions: [] },
      { key: 'withinMonth', label: t('historyBuckets.withinMonth'), sessions: [] },
      { key: 'older', label: t('historyBuckets.older'), sessions: [] },
    ];
    const bucketMap = Object.fromEntries(buckets.map((bucket) => [bucket.key, bucket])) as Record<
      SessionBucketKey,
      (typeof buckets)[number]
    >;
    for (const session of [...projectSessions].sort(
      (a, b) => (sessionLastActivity[b.key] ?? 0) - (sessionLastActivity[a.key] ?? 0),
    )) {
      const bucketKey = getSessionBucket(sessionLastActivity[session.key] ?? 0, nowMs);
      bucketMap[bucketKey].sessions.push(session);
    }
    return buckets;
  }, [t, projectSessions, sessionLastActivity, nowMs]);

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
  
  const onListDragStart = useCallback(
    (e: React.MouseEvent) => {
      isListDragging.current = true;
      listDragStartX.current = e.clientX;
      listDragStartWidth.current = listWidth;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';

      const onMove = (ev: MouseEvent) => {
        if (!isListDragging.current) return;
        const delta = ev.clientX - listDragStartX.current;
        const containerWidth = containerRef.current?.clientWidth ?? window.innerWidth;
        const maxByContainer = containerWidth - CHAT_MIN_WIDTH - editorWidth - 8;
        const dynamicMaxWidth = Math.max(
          LIST_MIN_WIDTH,
          Math.min(LIST_MAX_WIDTH, maxByContainer),
        );
        const next = Math.min(
          dynamicMaxWidth,
          Math.max(LIST_MIN_WIDTH, listDragStartWidth.current + delta),
        );
        setListWidth(next);
      };
      const onUp = () => {
        isListDragging.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [editorWidth, listWidth],
  );

  // Drag-to-resize editor while preserving chat page behavior from main branch.
  const onEditorDragStart = useCallback(
    (e: React.MouseEvent) => {
      isEditorDragging.current = true;
      editorDragStartX.current = e.clientX;
      editorDragStartWidth.current = editorWidth;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';

      const onMove = (ev: MouseEvent) => {
        if (!isEditorDragging.current) return;
        const delta = ev.clientX - editorDragStartX.current;
        const containerWidth = containerRef.current?.clientWidth ?? window.innerWidth;
        const maxByContainer = Math.max(
          EDITOR_MIN_WIDTH,
          containerWidth - CHAT_MIN_WIDTH - listWidth - 8,
        );
        const dynamicMaxWidth = Math.min(EDITOR_MAX_WIDTH, maxByContainer);
        const next = Math.min(
          dynamicMaxWidth,
          Math.max(EDITOR_MIN_WIDTH, editorDragStartWidth.current - delta),
        );
        setEditorWidth(next);
      };
      const onUp = () => {
        isEditorDragging.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [editorWidth, listWidth]
  );

  const handleNewProjectSession = useCallback(async () => {
    if (!workspacePath) return;
    const current = useChatStore.getState();
    if (current.messages.length > 0) {
      newSession();
      const newSessionKey = useChatStore.getState().currentSessionKey;
      if (newSessionKey) {
        await bindProjectToSession(newSessionKey, workspacePath);
      }
    } else if (current.currentSessionKey) {
      await bindProjectToSession(current.currentSessionKey, workspacePath);
    }
  }, [workspacePath, newSession, bindProjectToSession]);

  return (
    <div
      ref={containerRef}
      className={cn('flex h-full transition-colors duration-500 dark:bg-background')}
    >
      {!isSessionListCollapsed && (
        <>
          {/* Chat List Panel */}
          <div
            className="shrink-0 overflow-y-auto overflow-x-hidden px-3 py-4 space-y-0.5"
            style={{ width: listWidth }}
          >
            {workspacePath && (
              <>
                <button
                  onClick={() => void handleNewProjectSession()}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[14px] font-medium transition-colors mb-2',
                    'bg-black/5 dark:bg-accent shadow-none border border-transparent text-foreground',
                  )}
                >
                  <div className="flex shrink-0 items-center justify-center text-foreground/80">
                    <Plus className="h-[18px] w-[18px]" strokeWidth={2} />
                  </div>
                  <span className="flex-1 text-left overflow-hidden text-ellipsis whitespace-nowrap">
                    {t('common:sidebar.newChat')}
                  </span>
                </button>

                {sessionBuckets.map((bucket) =>
                  bucket.sessions.length > 0 ? (
                    <div key={bucket.key} className="pt-2">
                      <div className="px-2.5 pb-1 text-[11px] font-medium text-muted-foreground/60 tracking-tight">
                        {bucket.label}
                      </div>
                      {bucket.sessions.map((session) => {
                        const agentId = getAgentIdFromSessionKey(session.key);
                        const agentName = agentNameById[agentId] || agentId;
                        return (
                          <div key={session.key} className="group relative flex items-center">
                            <button
                              onClick={() => {
                                switchSession(session.key);
                                navigate('/');
                              }}
                              className={cn(
                                'w-full text-left rounded-lg px-2.5 py-1.5 text-[13px] transition-colors pr-7',
                                'hover:bg-black/5 dark:hover:bg-white/5',
                                currentSessionKey === session.key
                                  ? 'bg-black/5 dark:bg-white/10 text-foreground font-medium'
                                  : 'text-foreground/75',
                              )}
                            >
                              <div className="flex min-w-0 items-center gap-2">
                                <span className="shrink-0 rounded-full bg-black/[0.04] px-2 py-0.5 text-[10px] font-medium text-foreground/70 dark:bg-white/[0.08]">
                                  {agentName}
                                </span>
                                <span className="truncate">
                                  {getSessionLabel(session.key, session.displayName, session.label)}
                                </span>
                              </div>
                            </button>
                            <button
                              aria-label="Delete session"
                              onClick={(event) => {
                                event.stopPropagation();
                                setSessionToDelete({
                                  key: session.key,
                                  label: getSessionLabel(session.key, session.displayName, session.label),
                                });
                              }}
                              className={cn(
                                'absolute right-1 flex items-center justify-center rounded p-0.5 transition-opacity',
                                'opacity-0 group-hover:opacity-100',
                                'text-muted-foreground hover:text-destructive hover:bg-destructive/10',
                              )}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  ) : null,
                )}
              </>
            )}
          </div>

          <div
            onMouseDown={onListDragStart}
            className="w-1 h-full cursor-col-resize -mr-0.5 z-9"
            title="拖动调整宽度"
          ></div>
        </>
      )}

      {/* Chat Panel */}
      <div className={cn(
        "relative flex flex-1 flex-col overflow-hidden",
        !isSessionListCollapsed && "rounded-ss-lg border-l"
      )}>
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
        onMouseDown={onEditorDragStart}
        className="w-1 h-full cursor-col-resize -mr-0.5 z-9"
        title="拖动调整宽度"
      ></div>

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
                <div className="w-full flex items-center justify-start gap-2 px-4 py-1">
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

      {workspacePath && (
        <div
          className={cn(
            'shrink-0 overflow-hidden  border-border bg-background transition-[width] duration-200 ease-out',
            isFileTreeDrawerOpen ? 'w-[260px]' : 'w-0 pointer-events-none border-l-0 border-t-0'
          )}
        >
          <FileTree key={workspacePath} className="h-full" />
        </div>
      )}

      <ConfirmDialog
        open={!!sessionToDelete}
        title={t('common:actions.confirm')}
        message={t('common:sidebar.deleteSessionConfirm', { label: sessionToDelete?.label })}
        confirmLabel={t('common:actions.delete')}
        cancelLabel={t('common:actions.cancel')}
        variant="destructive"
        onConfirm={async () => {
          if (!sessionToDelete) return;
          await deleteSession(sessionToDelete.key);
          if (currentSessionKey === sessionToDelete.key) {
            navigate('/');
          }
          setSessionToDelete(null);
        }}
        onCancel={() => setSessionToDelete(null)}
      />
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
