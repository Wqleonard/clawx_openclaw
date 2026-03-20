/**
 * Chat Page
 * Native React implementation communicating with OpenClaw Gateway
 * via gateway:rpc IPC. Session selector, thinking toggle, and refresh
 * are in the toolbar; messages render with markdown + streaming.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Loader2, Plus, Trash2 } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
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
import { CHAT_PANEL_SIZE, useChatStyleStore } from '@/stores/chatStyle';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { FileTree } from '@/components/filesystem';
import { MarkdownEditor } from '@/components/markdownEditor';
import { Button } from '@/components/ui/button';
import { useSettingsStore } from '@/stores/settings';
import { invokeIpc } from '@/lib/api-client';
import { toast } from 'sonner';
import { useLoginStore } from '@/stores/loginStore';
import { Drawer, DrawerContent } from '@/components/ui/drawer';
import { ProjectsRail } from '@/components/layout/ProjectsRail';

const INITIAL_NOW_MS = Date.now();
const SESSION_LIST_DRAWER_BREAKPOINT = 1400;
const FILE_TREE_DRAWER_BREAKPOINT = 1020;
const PROJECTS_RAIL_WIDTH = 64;
const RESIZE_HANDLE_WIDTH = 8;
let hasCheckedWorkspaceOnStartup = false;

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

function normalizeWorkspacePath(value: string): string {
  return value
    .replace(/[\\/]+/g, '/')
    .replace(/\/+$/, '')
    .toLowerCase();
}

function workspacePathMatches(left: string, right: string): boolean {
  const a = normalizeWorkspacePath(left);
  const b = normalizeWorkspacePath(right);
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

export function Chat() {
  const { t, i18n } = useTranslation(['chat', 'settings']);
  const navigate = useNavigate();
  const location = useLocation();
  const [mdViewMode, setMdViewMode] = useState<'source' | 'rendered'>('rendered');
  const persistedListWidth = useChatStyleStore((s) => s.listWidth);
  const persistedEditorWidth = useChatStyleStore((s) => s.editorWidth);
  const persistedFileTreeWidth = useChatStyleStore((s) => s.fileTreeWidth);
  const commitListWidth = useChatStyleStore((s) => s.setListWidth);
  const commitEditorWidth = useChatStyleStore((s) => s.setEditorWidth);
  const commitFileTreeWidth = useChatStyleStore((s) => s.setFileTreeWidth);
  const [listWidth, setListWidth] = useState(persistedListWidth);
  const [editorWidth, setEditorWidth] = useState(persistedEditorWidth);
  const [fileTreeWidth, setFileTreeWidth] = useState(persistedFileTreeWidth);
  const isListDragging = useRef(false);
  const listDragStartX = useRef(0);
  const listDragStartWidth = useRef(0);
  const listRafRef = useRef<number | null>(null);
  const listPendingWidthRef = useRef<number | null>(null);
  const isEditorDragging = useRef(false);
  const editorDragStartX = useRef(0);
  const editorDragStartWidth = useRef(0);
  const editorRafRef = useRef<number | null>(null);
  const editorPendingWidthRef = useRef<number | null>(null);
  const isFileTreeDragging = useRef(false);
  const fileTreeDragStartX = useRef(0);
  const fileTreeDragStartWidth = useRef(0);
  const fileTreeRafRef = useRef<number | null>(null);
  const fileTreePendingWidthRef = useRef<number | null>(null);
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
  const projectPath = useFileSystemStore((s) => s.projectPath);
  const workspaceRoots = useSettingsStore((s) => s.workspaceRoots);
  const setWorkspaceRoots = useSettingsStore((s) => s.setWorkspaceRoots);
  const setupComplete = useSettingsStore((s) => s.setupComplete);
  const isLoggedIn = useLoginStore((s) => s.isLoggedIn);

  const bindProjectToSession = useFileSystemStore((s) => s.bindProjectToSession);
  const projectBindings = useFileSystemStore((s) => s.projectBindings);
  const projectShortcuts = useFileSystemStore((s) => s.projectShortcuts);
  const activeFile = useFileSystemStore((s) => s.activeFile);
  const fileContents = useFileSystemStore((s) => s.fileContents);
  const applyProjectForSession = useFileSystemStore((s) => s.applyProjectForSession);
  const initProject = useFileSystemStore((s) => s.initProject);
  const updateFileContent = useFileSystemStore((s) => s.updateFileContent);
  const saveFile = useFileSystemStore((s) => s.saveFile);
  const isFileTreeDrawerOpen = useChatLayoutStore((s) => s.isFileTreeDrawerOpen);
  const setFileTreeDrawerOpen = useChatLayoutStore((s) => s.setFileTreeDrawerOpen);
  const isSessionListCollapsed = useChatLayoutStore((s) => s.isSessionListCollapsed);
  const isSessionDrawerOpen = useChatLayoutStore((s) => s.isSessionDrawerOpen);
  const isSessionDrawerMode = useChatLayoutStore((s) => s.isSessionDrawerMode);
  const isFileTreeDrawerMode = useChatLayoutStore((s) => s.isFileTreeDrawerMode);
  const setProjectSwitching = useChatLayoutStore((s) => s.setProjectSwitching);
  const setSessionDrawerOpen = useChatLayoutStore((s) => s.setSessionDrawerOpen);
  const setSessionDrawerMode = useChatLayoutStore((s) => s.setSessionDrawerMode);
  const setFileTreeDrawerMode = useChatLayoutStore((s) => s.setFileTreeDrawerMode);
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [sessionToDelete, setSessionToDelete] = useState<{ key: string; label: string } | null>(
    null
  );
  const [nowMs, setNowMs] = useState(INITIAL_NOW_MS);

  const [streamingTimestamp, setStreamingTimestamp] = useState<number>(0);
  const prevSessionDrawerModeRef = useRef(isSessionDrawerMode);
  const prevFileTreeDrawerModeRef = useRef(isFileTreeDrawerMode);


  const [isListResizing, setIsListResizing] = useState(false);
  const [isEditorResizing, setIsEditorResizing] = useState(false);
  const [isFileTreeResizing, setIsFileTreeResizing] = useState(false);
  const [showWorkspaceSetupDialog, setShowWorkspaceSetupDialog] = useState(false);
  const minLoading = useMinLoading(loading && messages.length > 0);
  const { contentRef, scrollRef } = useStickToBottomInstant(currentSessionKey);
  const isZh = i18n.language?.startsWith('zh');
  const isOnChatRoute = location.pathname === '/' || location.pathname === '/chat';
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

  const handlePickWorkspaceRoot = useCallback(async () => {
    try {
      const result = await invokeIpc<{ canceled: boolean; filePaths?: string[] }>('dialog:open', {
        properties: ['openDirectory'],
        defaultPath: workspaceRoots || undefined,
      });
      if (result.canceled || !result.filePaths?.length) return;
      setWorkspaceRoots(result.filePaths[0]);
      toast.success(t('settings:workspace.saved'));
    } catch {
      toast.error(t('settings:workspace.saveFailed'));
    }
  }, [setWorkspaceRoots, t, workspaceRoots]);

  const workspaceSetupDialog = (
    <ConfirmDialog
      open={showWorkspaceSetupDialog}
      title={isZh ? '设置工作区' : 'Set Workspace'}
      message={
        isZh
          ? '检测到你还没有配置工作区。是否现在选择一个工作区目录？'
          : 'No workspace is configured yet. Do you want to pick a workspace directory now?'
      }
      confirmLabel={t('common:actions.confirm')}
      cancelLabel={t('common:actions.cancel')}
      onConfirm={async () => {
        setShowWorkspaceSetupDialog(false);
        await handlePickWorkspaceRoot();
      }}
      onCancel={() => setShowWorkspaceSetupDialog(false)}
    />
  );

  useEffect(() => {
    if (hasCheckedWorkspaceOnStartup) return;
    if (!isLoggedIn || !setupComplete || !isOnChatRoute) return;
    const configuredRoot = workspaceRoots.trim();
    hasCheckedWorkspaceOnStartup = true;
    if (!configuredRoot) {
      setShowWorkspaceSetupDialog(true);
      return;
    }

    // Treat missing/deleted configured path as "not configured".
    void invokeIpc<string>('fs:set-workspace', configuredRoot).catch(() => {
      setWorkspaceRoots('');
      setShowWorkspaceSetupDialog(true);
    });
  }, [isLoggedIn, setupComplete, isOnChatRoute, workspaceRoots, setWorkspaceRoots]);

  useEffect(() => {
    if (projectPath) return;
    initTaskVersionRef.current += 1;
    setProjectSwitching(false);
    resetChatRuntimeState();
  }, [projectPath, resetChatRuntimeState, setProjectSwitching]);

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
        if (!projectPath) {
          if (isTaskAborted()) return;
          resetChatRuntimeState();
          return;
        }

        // 1) Initialize sessions after current project is known.
        await loadSessions();
        if (isTaskAborted()) return;

        const chatState = useChatStore.getState();
        const fsState = useFileSystemStore.getState();

        // Prefer agent-based session routing: match workspace to a known agent and
        // find sessions by key prefix.  This avoids the projectBindings→switchSession
        // loop that caused the "jumps back to oldest conversation" bug.
        const normWs = (p: string) => p.replace(/[\\/]+/g, '/').replace(/\/+$/, '');
        const matchingAgent = agents.find((a) => normWs(a.workspace) === normWs(projectPath!));

        if (matchingAgent) {
          const currentAgentId = getAgentIdFromSessionKey(chatState.currentSessionKey);
          if (currentAgentId === matchingAgent.id) {
            // Already on this agent's session — just load history, don't switch.
            const hasExistingMessages = chatState.messages.length > 0;
            await loadHistory(hasExistingMessages);
            if (isTaskAborted()) return;
            return;
          }
          // Switch to the most recent session for this agent.
          const agentSessions = [...chatState.sessions]
            .filter((s) => s.key.startsWith(`agent:${matchingAgent.id}:`))
            .sort(
              (a, b) =>
                (chatState.sessionLastActivity[b.key] ?? 0) -
                (chatState.sessionLastActivity[a.key] ?? 0)
            );
          const targetKey = agentSessions[0]?.key ?? `agent:${matchingAgent.id}:main`;
          if (targetKey !== chatState.currentSessionKey) {
            if (isTaskAborted()) return;
            switchSession(targetKey);
          }
          return;
        }

        // Non-agent workspace: fall back to projectBindings lookup.
        const targetSessions = [...chatState.sessions]
          .filter((session) => fsState.projectBindings[session.key] === projectPath)
          .sort(
            (a, b) =>
              (chatState.sessionLastActivity[b.key] ?? 0) -
              (chatState.sessionLastActivity[a.key] ?? 0)
          );

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

        // No bound sessions: create one and bind it to current project.
        if (isTaskAborted()) return;
        newSession();
        if (isTaskAborted()) return;
        const newSessionKey = useChatStore.getState().currentSessionKey;
        if (newSessionKey) {
          await bindProjectToSession(newSessionKey, projectPath);
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
    agents,
    projectPath,
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
    const updateSessionDrawerMode = () => {
      const nextMode = window.innerWidth < SESSION_LIST_DRAWER_BREAKPOINT;
      setSessionDrawerMode(nextMode);
      if (!nextMode) {
        setSessionDrawerOpen(false);
      }
    };
    const updateFileTreeDrawerMode = () => {
      const nextMode = window.innerWidth < FILE_TREE_DRAWER_BREAKPOINT;
      setFileTreeDrawerMode(nextMode);
    };
    updateSessionDrawerMode();
    updateFileTreeDrawerMode();
    window.addEventListener('resize', updateSessionDrawerMode);
    window.addEventListener('resize', updateFileTreeDrawerMode);
    return () => {
      window.removeEventListener('resize', updateSessionDrawerMode);
      window.removeEventListener('resize', updateFileTreeDrawerMode);
    };
  }, [setFileTreeDrawerMode, setSessionDrawerMode, setSessionDrawerOpen]);

  useEffect(() => {
    const wasDrawerMode = prevSessionDrawerModeRef.current;
    if (wasDrawerMode !== isSessionDrawerMode) {
      setSessionDrawerOpen(false);
    }
    prevSessionDrawerModeRef.current = isSessionDrawerMode;
  }, [isSessionDrawerMode, setSessionDrawerOpen]);

  useEffect(() => {
    const wasDrawerMode = prevFileTreeDrawerModeRef.current;
    if (!wasDrawerMode && isFileTreeDrawerMode) {
      setFileTreeDrawerOpen(false);
    }
    prevFileTreeDrawerModeRef.current = isFileTreeDrawerMode;
  }, [isFileTreeDrawerMode, setFileTreeDrawerOpen]);

  useEffect(() => {
    // Keep the persisted selection as the source of truth on refresh.
    // Only derive project from session/agent when no project is currently selected.
    if (projectPath) {
      return;
    }
    // No project exists at all: do not auto-recover workspace from session.
    if (projectShortcuts.length === 0) {
      return;
    }
    // Look up the agent's workspace from the snapshot (set at creation time, stored in
    // openclaw.json). Only call initProject to refresh the file tree — do NOT call
    // syncAgentProjectBinding / applyProjectForSession, which would rewrite openclaw.json
    // and trigger a Gateway reconnect on every agent switch.
    const agentId = getAgentIdFromSessionKey(currentSessionKey);
    const agent = agents.find((a) => a.id === agentId);
    if (agent?.workspace) {
      void initProject(agent.workspace);
    } else {
      // Fallback for sessions without a resolved agent (e.g. legacy sessions)
      void applyProjectForSession(currentSessionKey);
    }
  }, [
    projectPath,
    projectShortcuts,
    currentSessionKey,
    agents,
    initProject,
    applyProjectForSession,
  ]);

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
  const resizeHandleTitle = t('common:actions.resizePanel');
  const getSessionLabel = useCallback(
    (key: string, displayName?: string, label?: string) =>
      sessionLabels[key] ?? label ?? displayName ?? key,
    [sessionLabels]
  );
  const agentNameById = useMemo(
    () => Object.fromEntries(agents.map((agent) => [agent.id, agent.name])),
    [agents]
  );
  const projectSessions = useMemo(() => {
    if (!projectPath) return [];
    return sessions.filter((session) => projectBindings[session.key] === projectPath);
  }, [projectPath, sessions, projectBindings]);
  const sessionBuckets: Array<{ key: SessionBucketKey; label: string; sessions: typeof sessions }> =
    useMemo(() => {
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
        (a, b) => (sessionLastActivity[b.key] ?? 0) - (sessionLastActivity[a.key] ?? 0)
      )) {
        const bucketKey = getSessionBucket(sessionLastActivity[session.key] ?? 0, nowMs);
        bucketMap[bucketKey].sessions.push(session);
      }
      return buckets;
    }, [t, projectSessions, sessionLastActivity, nowMs]);
  useEffect(() => {
    if (!isListDragging.current) {
      setListWidth(persistedListWidth);
    }
  }, [persistedListWidth]);
  useEffect(() => {
    if (!isEditorDragging.current) {
      setEditorWidth(persistedEditorWidth);
    }
  }, [persistedEditorWidth]);
  useEffect(() => {
    if (!isFileTreeDragging.current) {
      setFileTreeWidth(persistedFileTreeWidth);
    }
  }, [persistedFileTreeWidth]);
  const isSessionListInlineVisible = !isSessionDrawerMode && !isSessionListCollapsed;
  const effectiveListWidth = isSessionListInlineVisible ? listWidth : 0;
  const isFileTreeInlineVisible = !!projectPath && isFileTreeDrawerOpen && !isFileTreeDrawerMode;
  const effectiveFileTreeWidth = isFileTreeInlineVisible ? fileTreeWidth : 0;
  const fixedNonPanelWidth =
    (isSessionDrawerMode ? 0 : PROJECTS_RAIL_WIDTH) +
    (isSessionListInlineVisible ? RESIZE_HANDLE_WIDTH : 0) +
    RESIZE_HANDLE_WIDTH +
    (isFileTreeInlineVisible ? RESIZE_HANDLE_WIDTH : 0) +
    8;

  useEffect(() => {
    const clampEditorWidthForViewport = () => {
      if (isEditorDragging.current) return;
      const containerWidth = containerRef.current?.clientWidth ?? window.innerWidth;
      const maxByContainer =
        containerWidth -
        CHAT_PANEL_SIZE.chatMinWidth -
        effectiveListWidth -
        effectiveFileTreeWidth -
        fixedNonPanelWidth;
      const maxAllowed = Math.min(CHAT_PANEL_SIZE.editor.max, Math.max(0, maxByContainer));
      setEditorWidth((prev) => (prev > maxAllowed ? maxAllowed : prev));
    };

    clampEditorWidthForViewport();
    window.addEventListener('resize', clampEditorWidthForViewport);
    return () => window.removeEventListener('resize', clampEditorWidthForViewport);
  }, [
    effectiveFileTreeWidth,
    effectiveListWidth,
    fixedNonPanelWidth,
  ]);

  const isEmpty = messages.length === 0 && !sending;
  const activeMarkdownFile = activeFile && isMarkdownFile(activeFile) ? activeFile : null;
  const activeMarkdownContent = activeMarkdownFile ? (fileContents[activeMarkdownFile] ?? '') : '';
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

  useEffect(() => {
    return () => {
      if (listRafRef.current != null) {
        window.cancelAnimationFrame(listRafRef.current);
      }
      if (editorRafRef.current != null) {
        window.cancelAnimationFrame(editorRafRef.current);
      }
      if (fileTreeRafRef.current != null) {
        window.cancelAnimationFrame(fileTreeRafRef.current);
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
      setIsListResizing(true);
      listDragStartX.current = e.clientX;
      listDragStartWidth.current = listWidth;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';

      const onMove = (ev: MouseEvent) => {
        if (!isListDragging.current) return;
        const delta = ev.clientX - listDragStartX.current;
        const containerWidth = containerRef.current?.clientWidth ?? window.innerWidth;
        const maxByContainer =
          containerWidth - CHAT_PANEL_SIZE.chatMinWidth - editorWidth - effectiveFileTreeWidth - fixedNonPanelWidth;
        const dynamicMaxWidth = Math.min(CHAT_PANEL_SIZE.list.max, Math.max(0, maxByContainer));
        const dynamicMinWidth = Math.min(CHAT_PANEL_SIZE.list.min, dynamicMaxWidth);
        const next = Math.min(
          dynamicMaxWidth,
          Math.max(dynamicMinWidth, listDragStartWidth.current + delta)
        );
        listPendingWidthRef.current = next;
        if (listRafRef.current == null) {
          listRafRef.current = window.requestAnimationFrame(() => {
            listRafRef.current = null;
            if (listPendingWidthRef.current != null) {
              setListWidth(listPendingWidthRef.current);
            }
          });
        }
      };
      const onUp = () => {
        isListDragging.current = false;
        setIsListResizing(false);
        if (listRafRef.current != null) {
          window.cancelAnimationFrame(listRafRef.current);
          listRafRef.current = null;
        }
        const finalWidth = listPendingWidthRef.current;
        if (finalWidth != null) {
          setListWidth(finalWidth);
          commitListWidth(finalWidth);
          listPendingWidthRef.current = null;
        } else {
          commitListWidth(listWidth);
        }
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [editorWidth, effectiveFileTreeWidth, listWidth, commitListWidth, fixedNonPanelWidth]
  );

  // Drag-to-resize editor while preserving chat page behavior from main branch.
  const onEditorDragStart = useCallback(
    (e: React.MouseEvent) => {
      isEditorDragging.current = true;
      setIsEditorResizing(true);
      editorDragStartX.current = e.clientX;
      editorDragStartWidth.current = editorWidth;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';

      const onMove = (ev: MouseEvent) => {
        if (!isEditorDragging.current) return;
        const delta = ev.clientX - editorDragStartX.current;
        const containerWidth = containerRef.current?.clientWidth ?? window.innerWidth;
        const maxByContainer =
          containerWidth -
          CHAT_PANEL_SIZE.chatMinWidth -
          effectiveListWidth -
          effectiveFileTreeWidth -
          fixedNonPanelWidth;
        const dynamicMaxWidth = Math.min(CHAT_PANEL_SIZE.editor.max, Math.max(0, maxByContainer));
        const dynamicMinWidth = Math.min(CHAT_PANEL_SIZE.editor.min, dynamicMaxWidth);
        const next = Math.min(
          dynamicMaxWidth,
          Math.max(dynamicMinWidth, editorDragStartWidth.current - delta)
        );
        editorPendingWidthRef.current = next;
        if (editorRafRef.current == null) {
          editorRafRef.current = window.requestAnimationFrame(() => {
            editorRafRef.current = null;
            if (editorPendingWidthRef.current != null) {
              setEditorWidth(editorPendingWidthRef.current);
            }
          });
        }
      };
      const onUp = () => {
        isEditorDragging.current = false;
        setIsEditorResizing(false);
        if (editorRafRef.current != null) {
          window.cancelAnimationFrame(editorRafRef.current);
          editorRafRef.current = null;
        }
        const finalWidth = editorPendingWidthRef.current;
        if (finalWidth != null) {
          setEditorWidth(finalWidth);
          if (finalWidth >= CHAT_PANEL_SIZE.editor.min) {
            commitEditorWidth(finalWidth);
          }
          editorPendingWidthRef.current = null;
        } else {
          commitEditorWidth(editorWidth);
        }
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [editorWidth, effectiveFileTreeWidth, effectiveListWidth, commitEditorWidth, fixedNonPanelWidth]
  );

  const onFileTreeDragStart = useCallback(
    (e: React.MouseEvent) => {
      if (!projectPath || !isFileTreeDrawerOpen) return;
      isFileTreeDragging.current = true;
      setIsFileTreeResizing(true);
      fileTreeDragStartX.current = e.clientX;
      fileTreeDragStartWidth.current = fileTreeWidth;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';

      const onMove = (ev: MouseEvent) => {
        if (!isFileTreeDragging.current) return;
        const delta = ev.clientX - fileTreeDragStartX.current;
        const containerWidth = containerRef.current?.clientWidth ?? window.innerWidth;
        const maxByContainer =
          containerWidth - CHAT_PANEL_SIZE.chatMinWidth - effectiveListWidth - editorWidth - fixedNonPanelWidth;
        const dynamicMaxWidth = Math.min(CHAT_PANEL_SIZE.fileTree.max, Math.max(0, maxByContainer));
        const dynamicMinWidth = Math.min(CHAT_PANEL_SIZE.fileTree.min, dynamicMaxWidth);
        const next = Math.min(
          dynamicMaxWidth,
          Math.max(dynamicMinWidth, fileTreeDragStartWidth.current - delta)
        );
        fileTreePendingWidthRef.current = next;
        if (fileTreeRafRef.current == null) {
          fileTreeRafRef.current = window.requestAnimationFrame(() => {
            fileTreeRafRef.current = null;
            if (fileTreePendingWidthRef.current != null) {
              setFileTreeWidth(fileTreePendingWidthRef.current);
            }
          });
        }
      };

      const onUp = () => {
        isFileTreeDragging.current = false;
        setIsFileTreeResizing(false);
        if (fileTreeRafRef.current != null) {
          window.cancelAnimationFrame(fileTreeRafRef.current);
          fileTreeRafRef.current = null;
        }
        if (fileTreePendingWidthRef.current != null) {
          const finalWidth = fileTreePendingWidthRef.current;
          setFileTreeWidth(finalWidth);
          commitFileTreeWidth(finalWidth);
          fileTreePendingWidthRef.current = null;
        } else {
          commitFileTreeWidth(fileTreeWidth);
        }
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };

      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [
      projectPath,
      isFileTreeDrawerOpen,
      fileTreeWidth,
      effectiveListWidth,
      editorWidth,
      commitFileTreeWidth,
      fixedNonPanelWidth,
    ]
  );

  const handleNewProjectSession = useCallback(async () => {
    if (!projectPath) return;
    let matchedAgent = agents.find((agent) => workspacePathMatches(agent.workspace, projectPath));
    if (!matchedAgent) {
      await fetchAgents();
      matchedAgent = useAgentsStore
        .getState()
        .agents.find((agent) => workspacePathMatches(agent.workspace, projectPath));
    }
    if (matchedAgent) {
      const chatState = useChatStore.getState();
      const expectedPrefix = `agent:${matchedAgent.id}:`;
      if (!chatState.currentSessionKey.startsWith(expectedPrefix)) {
        const alignedSessionKey =
          [...chatState.sessions]
            .filter((session) => session.key.startsWith(expectedPrefix))
            .sort(
              (a, b) =>
                (chatState.sessionLastActivity[b.key] ?? 0) -
                (chatState.sessionLastActivity[a.key] ?? 0)
            )[0]?.key ?? `${expectedPrefix}main`;
        if (alignedSessionKey !== chatState.currentSessionKey) {
          switchSession(alignedSessionKey);
        }
      }
    }

    const previousSessionKey = useChatStore.getState().currentSessionKey;
    newSession();
    const newSessionKey = useChatStore.getState().currentSessionKey;
    if (newSessionKey && newSessionKey !== previousSessionKey) {
      await bindProjectToSession(newSessionKey, projectPath);
    }
    if (isSessionDrawerMode) {
      setSessionDrawerOpen(false);
    }
  }, [
    projectPath,
    agents,
    fetchAgents,
    switchSession,
    newSession,
    bindProjectToSession,
    isSessionDrawerMode,
    setSessionDrawerOpen,
  ]);

  const handleSendMessage = useCallback(
    async (
      text: string,
      attachments?: Array<{
        id: string;
        fileName: string;
        mimeType: string;
        fileSize: number;
        stagedPath: string;
        preview: string | null;
      }>,
      targetAgentId?: string | null
    ) => {
      let matchedAgent = projectPath
        ? agents.find((agent) => workspacePathMatches(agent.workspace, projectPath))
        : undefined;
      if (projectPath && !matchedAgent) {
        await fetchAgents();
        matchedAgent = useAgentsStore
          .getState()
          .agents.find((agent) => workspacePathMatches(agent.workspace, projectPath));
      }

      const enforcedTargetAgentId = matchedAgent?.id ?? targetAgentId ?? undefined;
      if (matchedAgent) {
        const chatState = useChatStore.getState();
        const expectedPrefix = `agent:${matchedAgent.id}:`;
        if (!chatState.currentSessionKey.startsWith(expectedPrefix)) {
          const alignedSessionKey =
            [...chatState.sessions]
              .filter((session) => session.key.startsWith(expectedPrefix))
              .sort(
                (a, b) =>
                  (chatState.sessionLastActivity[b.key] ?? 0) -
                  (chatState.sessionLastActivity[a.key] ?? 0)
              )[0]?.key ?? `${expectedPrefix}main`;
          if (alignedSessionKey !== chatState.currentSessionKey) {
            switchSession(alignedSessionKey);
          }
        }
      }

      const beforeSendSessionKey = useChatStore.getState().currentSessionKey;
      if (
        projectPath &&
        beforeSendSessionKey &&
        projectBindings[beforeSendSessionKey] !== projectPath
      ) {
        await bindProjectToSession(beforeSendSessionKey, projectPath);
      }
      await sendMessage(text, attachments, enforcedTargetAgentId);
      const latestSessionKey = useChatStore.getState().currentSessionKey;
      const latestBindings = useFileSystemStore.getState().projectBindings;
      if (projectPath && latestSessionKey && latestBindings[latestSessionKey] !== projectPath) {
        await bindProjectToSession(latestSessionKey, projectPath);
      }
    },
    [
      projectPath,
      projectBindings,
      bindProjectToSession,
      sendMessage,
      agents,
      switchSession,
      fetchAgents,
    ]
  );

  const openCreateProjectDialog = useCallback(() => {
    window.dispatchEvent(new CustomEvent('project:create-request'));
  }, []);

  const sessionListContent = (
    <>
      <button
        onClick={() => void handleNewProjectSession()}
        className={cn(
          'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[14px] font-medium transition-colors mb-2',
          'bg-black/5 dark:bg-accent shadow-none border border-transparent text-foreground'
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
                      if (isSessionDrawerMode) {
                        setSessionDrawerOpen(false);
                      }
                    }}
                    className={cn(
                      'w-full text-left rounded-lg px-2.5 py-1.5 text-[13px] transition-colors pr-7',
                      'hover:bg-black/5 dark:hover:bg-white/5',
                      currentSessionKey === session.key
                        ? 'bg-black/5 dark:bg-white/10 text-foreground font-medium'
                        : 'text-foreground/75'
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
                      'text-muted-foreground hover:text-destructive hover:bg-destructive/10'
                    )}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        ) : null
      )}
    </>
  );

  if (!projectPath) {
    return (
      <>
        <ProjectRequiredScreen onCreateProject={openCreateProjectDialog} />
        {workspaceSetupDialog}
      </>
    );
  }

  return (
    <div
      ref={containerRef}
      className={cn(
        'w-full min-w-0 max-w-full overflow-hidden px-3 py-3 flex h-full transition-colors duration-500 dark:bg-background',
        isSessionDrawerMode ? 'pl-3' : 'pl-0'
      )}
    >
      {!isSessionDrawerMode && <ProjectsRail />}

      {/* Session List Panel */}
      {!isSessionDrawerMode && (
        <>
          {/* Chat List Panel */}
          <div
            className={cn(
              'rounded-2xl border shrink-0 overflow-y-auto overflow-x-hidden space-y-0.5',
              isListResizing ? 'transition-none' : 'transition-[width] duration-200 ease-out',
              isSessionListInlineVisible
                ? 'pointer-events-auto px-3 py-4'
                : 'w-0 p-0 pointer-events-none border-none'
            )}
            style={isSessionListInlineVisible ? { width: listWidth } : undefined}
          >
            {projectPath && sessionListContent}
          </div>

          {isSessionListInlineVisible && (
            <div
              onMouseDown={onListDragStart}
              className="w-2 h-full cursor-col-resize group shrink-0"
              title={resizeHandleTitle}
            >
              <div
                className={cn(
                  'w-0.5 mx-auto h-full',
                  isListResizing ? 'bg-[var(--theme)]' : 'group-hover:bg-[var(--theme)]'
                )}
              ></div>
            </div>
          )}
        </>
      )}
      {isSessionDrawerMode && projectPath && (
        <Drawer
          open={isSessionDrawerOpen}
          onOpenChange={(open) => setSessionDrawerOpen(open)}
          direction="left"
          modal
        >
          <DrawerContent
            hideOverlay
            className="border-none py-3 space-y-0.5 max-w-none data-[vaul-drawer-direction=left]:top-10 data-[vaul-drawer-direction=left]:h-auto"
          >
            <div className="flex h-full">
              <ProjectsRail />
              <div className="h-[calc(100%+2px)] p-3 -mt-[2px] flex-1 border rounded-ss-2xl rounded-es-2xl overflow-y-auto overflow-x-hidden">
                {sessionListContent}
              </div>
            </div>
          </DrawerContent>
        </Drawer>
      )}

      {/* Chat Panel */}
      <div className={cn('rounded-2xl border relative flex flex-1 min-w-[300px] flex-col overflow-hidden')}>
        {/* Toolbar */}
        <div className="flex shrink-0 items-center justify-end px-4 py-2">
          <ChatToolbar />
        </div>

        {/* Messages Area */}
        <div
          ref={scrollRef}
          className={cn(
            'scrollbar-hover flex-1 min-h-0 overflow-y-auto overflow-x-hidden',
            !projectPath && 'pointer-events-none opacity-70'
          )}
        >
          <div className="w-full px-4 min-w-0 overflow-x-auto">
            <div ref={contentRef} className="mx-auto w-full min-w-0 max-w-4xl space-y-4">
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
          onSend={handleSendMessage}
          onStop={abortRun}
          disabled={!isGatewayRunning || !projectPath}
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
        className="w-2 h-full cursor-col-resize group shrink-0"
        title={resizeHandleTitle}
      >
        <div
          className={cn(
            'w-0.5 mx-auto h-full',
            isEditorResizing ? 'bg-[var(--theme)]' : 'group-hover:bg-[var(--theme)]'
          )}
        ></div>
      </div>

      {/* Markdown Viewer Panel */}
      <div
        className="group relative border rounded-2xl flex shrink-0 overflow-hidden"
        style={{ width: editorWidth }}
      >
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <div className="min-h-0 flex-1 overflow-hidden">
            {!activeMarkdownFile ? (
              <div className="flex h-full items-center justify-center px-4 text-center text-sm text-muted-foreground">
                点击文件树中的 `.md` 文件后，会在这里直接显示内容
              </div>
            ) : (
              <div className="w-full h-full flex flex-col">
                <MarkdownEditor
                  className="flex-1 min-h-0"
                  value={activeMarkdownContent}
                  mode={mdViewMode}
                  onModeChange={setMdViewMode}
                  onChange={handleMarkdownChange}
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {projectPath && (
        <>
          {!isFileTreeDrawerMode && (
            <>
              {/* resize dragger */}
              {isFileTreeInlineVisible && (
                <div
                  onMouseDown={onFileTreeDragStart}
                  className="w-2 h-full cursor-col-resize group shrink-0"
                  title={resizeHandleTitle}
                >
                  <div
                    className={cn(
                      'w-0.5 mx-auto h-full',
                      isFileTreeResizing ? 'bg-[var(--theme)]' : 'group-hover:bg-[var(--theme)]'
                    )}
                  ></div>
                </div>
              )}
              <div
                className={cn(
                  'rounded-2xl border shrink-0 overflow-hidden bg-background',
                  isFileTreeResizing ? 'transition-none' : 'transition-[width] duration-200 ease-out',
                  isFileTreeInlineVisible ? 'pointer-events-auto' : 'w-0 pointer-events-none border-none'
                )}
                style={isFileTreeInlineVisible ? { width: fileTreeWidth } : undefined}
              >
                <FileTree key={projectPath} className="h-full" />
              </div>
            </>
          )}
          {isFileTreeDrawerMode && (
            <Drawer
              direction="right"
              open={isFileTreeDrawerOpen}
              onOpenChange={(open) => setFileTreeDrawerOpen(open)}
              modal
            >
              <DrawerContent
                hideOverlay
                className="max-w-none py-3 !border-none !rounded-none data-[vaul-drawer-direction=right]:top-10 data-[vaul-drawer-direction=right]:h-auto"
                style={{ width: `min(86vw, ${fileTreeWidth}px)` }}
              >
                <div className="h-full  border overflow-hidden">
                  <FileTree key={`${projectPath}-drawer`} className="h-full" />
                </div>
              </DrawerContent>
            </Drawer>
          )}
        </>
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
          const deletingKey = sessionToDelete.key;
          const isDeletingCurrent = useChatStore.getState().currentSessionKey === deletingKey;
          setSessionToDelete(null);
          void deleteSession(deletingKey);
          if (isDeletingCurrent) {
            navigate('/');
          }
        }}
        onCancel={() => setSessionToDelete(null)}
      />
      {workspaceSetupDialog}
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

function ProjectRequiredScreen({ onCreateProject }: { onCreateProject: () => void }) {
  const { t } = useTranslation('chat');
  return (
    <div className="flex w-full h-full p-4 pl-0 justify-center text-center">
      <div className="flex flex-col w-full rounded-2xl border items-center justify-start">
        <h1 className="mt-[15%] font-bold text-[52px]">Story Claw</h1>
        <div className="mt-10 text-sm text-muted-foreground">{t('projectRequired')}</div>
        <Button className="mt-5" onClick={onCreateProject}>
          + {t('common:projectDialog.title')}
        </Button>
      </div>
    </div>
  );
}

// ── Typing Indicator ────────────────────────────────────────────

function TypingIndicator() {
  return (
    <div className="flex gap-3">
      {/* <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full mt-1 bg-black/5 dark:bg-white/5 text-foreground">
        <Sparkles className="h-4 w-4" />
      </div> */}
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
      {/* <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full mt-1 bg-black/5 dark:bg-white/5 text-foreground">
        <Sparkles className="h-4 w-4" />
      </div> */}
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
