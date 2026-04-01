/**
 * Chat Page
 * Native React implementation communicating with OpenClaw Gateway
 * via gateway:rpc IPC. Session selector, thinking toggle, and refresh
 * are in the toolbar; messages render with markdown + streaming.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, FolderPlus, Loader2, Trash2 } from 'lucide-react';
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
import {
  CHAT_PANEL_SIZE,
  FILE_TREE_DRAWER_BREAKPOINT,
  SESSION_LIST_DRAWER_BREAKPOINT,
  useChatLayoutStore,
} from '@/stores/chat-layout';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { FileTree } from '@/pages/Chat/filesystem';
import { Button } from '@/components/ui/button';
import { useSettingsStore } from '@/stores/settings';
import { invokeIpc } from '@/lib/api-client';
import { toast } from 'sonner';
// import { useLoginStore } from '@/stores/loginStore';
import { Drawer, DrawerContent, DrawerTitle } from '@/components/ui/drawer';
import { VisuallyHidden } from '@/components/ui/dialog';
import { FilePreview } from './FilePreview';

const INITIAL_NOW_MS = Date.now();
const PROJECTS_RAIL_WIDTH = 12;
const RESIZE_HANDLE_WIDTH = 8;
const CONTAINER_HORIZONTAL_PADDING_INLINE = 12;
const CONTAINER_HORIZONTAL_PADDING_DRAWER = 24;
const EMERGENCY_EDITOR_MIN_WIDTH = 200;

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

function getWorkspaceName(workspacePath: string): string {
  const normalized = workspacePath.replace(/[\\/]+$/, '');
  const segments = normalized.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] || workspacePath;
}

export function Chat() {
  const { t } = useTranslation(['chat', 'settings']);
  const navigate = useNavigate();
  // const location = useLocation();
  const [mdViewMode, setMdViewMode] = useState<'source' | 'rendered'>('rendered');
  const persistedEditorWidth = useChatLayoutStore((s) => s.editorWidth);
  const persistedFileTreeWidth = useChatLayoutStore((s) => s.fileTreeWidth);
  const commitEditorWidth = useChatLayoutStore((s) => s.setEditorWidth);
  const commitFileTreeWidth = useChatLayoutStore((s) => s.setFileTreeWidth);
  const [editorWidth, setEditorWidth] = useState(persistedEditorWidth);
  const [fileTreeWidth, setFileTreeWidth] = useState(persistedFileTreeWidth);
  const isEditorDragging = useRef(false);
  const editorDragStartX = useRef(0);
  const editorDragStartWidth = useRef(0);
  const editorDragStartChatWidth = useRef(0);
  const editorRafRef = useRef<number | null>(null);
  const editorPendingWidthRef = useRef<number | null>(null);
  const isFileTreeDragging = useRef(false);
  const fileTreeDragStartX = useRef(0);
  const fileTreeDragStartWidth = useRef(0);
  const fileTreeRafRef = useRef<number | null>(null);
  const fileTreePendingWidthRef = useRef<number | null>(null);
  const fileTreePendingEditorWidthRef = useRef<number | null>(null);
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
  const warning = useChatStore((s) => s.warning);
  const showThinking = useChatStore((s) => s.showThinking);
  const streamingMessage = useChatStore((s) => s.streamingMessage);
  const streamingTools = useChatStore((s) => s.streamingTools);
  const pendingFinal = useChatStore((s) => s.pendingFinal);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const abortRun = useChatStore((s) => s.abortRun);
  const clearError = useChatStore((s) => s.clearError);
  const clearWarning = useChatStore((s) => s.clearWarning);
  const switchSession = useChatStore((s) => s.switchSession);
  const newSession = useChatStore((s) => s.newSession);
  const deleteSession = useChatStore((s) => s.deleteSession);
  const loadSessions = useChatStore((s) => s.loadSessions);
  const loadHistory = useChatStore((s) => s.loadHistory);
  const fetchAgents = useAgentsStore((s) => s.fetchAgents);
  const agents = useAgentsStore((s) => s.agents);
  const deleteAgent = useAgentsStore((s) => s.deleteAgent);

  const cleanupEmptySession = useChatStore((s) => s.cleanupEmptySession);
  const projectPath = useFileSystemStore((s) => s.projectPath);
  const workspaceRoots = useSettingsStore((s) => s.workspaceRoots);
  const setWorkspaceRoots = useSettingsStore((s) => s.setWorkspaceRoots);
  // const setupComplete = useSettingsStore((s) => s.setupComplete);
  // const isLoggedIn = useLoginStore((s) => s.isLoggedIn);

  const bindProjectToSession = useFileSystemStore((s) => s.bindProjectToSession);
  const projectBindings = useFileSystemStore((s) => s.projectBindings);
  const projectShortcuts = useFileSystemStore((s) => s.projectShortcuts);
  const removeProjectShortcut = useFileSystemStore((s) => s.removeProjectShortcut);
  const clearProject = useFileSystemStore((s) => s.clearProject);
  const refreshTree = useFileSystemStore((s) => s.refreshTree);
  const activeFile = useFileSystemStore((s) => s.activeFile);
  const fileContents = useFileSystemStore((s) => s.fileContents);
  const applyProjectForSession = useFileSystemStore((s) => s.applyProjectForSession);
  const initProject = useFileSystemStore((s) => s.initProject);
  const updateFileContent = useFileSystemStore((s) => s.updateFileContent);
  const saveFile = useFileSystemStore((s) => s.saveFile);
  const isFileTreeDrawerOpen = useChatLayoutStore((s) => s.isFileTreeDrawerOpen);
  const setFileTreeDrawerOpen = useChatLayoutStore((s) => s.setFileTreeDrawerOpen);
  const isChatPanelCollapsed = useChatLayoutStore((s) => s.isChatPanelCollapsed);
  const isSessionDrawerMode = useChatLayoutStore((s) => s.isSessionDrawerMode);
  const isFileTreeDrawerMode = useChatLayoutStore((s) => s.isFileTreeDrawerMode);
  const isProjectSwitching = useChatLayoutStore((s) => s.isProjectSwitching);
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
  const lastTreeRefreshProjectRef = useRef<string | null>(null);

  const [isEditorResizing, setIsEditorResizing] = useState(false);
  const [isFileTreeResizing, setIsFileTreeResizing] = useState(false);
  const [projectToClose, setProjectToClose] = useState<string | null>(null);
  const minLoading = useMinLoading(loading && messages.length > 0);
  const { contentRef, scrollRef } = useStickToBottomInstant(currentSessionKey);
  const resetChatRuntimeState = useCallback(() => {
    useChatStore.setState({
      messages: [],
      loading: false,
      sending: false,
      error: null,
      warning: null,
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
  const handleRemoveWorkspaceRoot = useCallback(() => {
    setWorkspaceRoots('');
    toast.success(t('settings:workspace.saved'));
  }, [setWorkspaceRoots, t]);

  // const workspaceSetupDialog = (
  //   <ConfirmDialog
  //     open={showWorkspaceSetupDialog}
  //     title={isZh ? '设置工作区' : 'Set Workspace'}
  //     message={
  //       isZh
  //         ? '检测到你还没有配置工作区。是否现在选择一个工作区目录？'
  //         : 'No workspace is configured yet. Do you want to pick a workspace directory now?'
  //     }
  //     confirmLabel={t('common:actions.confirm')}
  //     cancelLabel={t('common:actions.cancel')}
  //     onConfirm={async () => {
  //       setShowWorkspaceSetupDialog(false);
  //       await handlePickWorkspaceRoot();
  //     }}
  //     onCancel={() => setShowWorkspaceSetupDialog(false)}
  //   />
  // );

  // useEffect(() => {
  //   if (hasCheckedWorkspaceOnStartup) return;
  //   if (!isLoggedIn || !setupComplete || !isOnChatRoute) return;
  //   const configuredRoot = workspaceRoots.trim();
  //   hasCheckedWorkspaceOnStartup = true;
  //   if (!configuredRoot) {
  //     setShowWorkspaceSetupDialog(true);
  //     return;
  //   }
  //
  //   // Treat missing/deleted configured path as "not configured".
  //   void invokeIpc<string>('fs:set-workspace', configuredRoot).catch(() => {
  //     setWorkspaceRoots('');
  //     setShowWorkspaceSetupDialog(true);
  //   });
  // }, [isLoggedIn, setupComplete, isOnChatRoute, workspaceRoots, setWorkspaceRoots]);

  useEffect(() => {
    if (projectPath) return;
    initTaskVersionRef.current += 1;
    setProjectSwitching(false);
    resetChatRuntimeState();
  }, [projectPath, resetChatRuntimeState, setProjectSwitching]);

  useEffect(() => {
    if (!projectPath) {
      lastTreeRefreshProjectRef.current = null;
      return;
    }
    if (isProjectSwitching) return;
    if (lastTreeRefreshProjectRef.current === projectPath) return;
    lastTreeRefreshProjectRef.current = projectPath;
    void refreshTree(projectPath);
  }, [projectPath, isProjectSwitching, refreshTree]);

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

  useEffect(() => {
    if (!projectPath || agents.length === 0) return;
    const matchedAgent = agents.find((agent) => workspacePathMatches(agent.workspace, projectPath));
    if (!matchedAgent) return;

    const chatState = useChatStore.getState();
    const expectedPrefix = `agent:${matchedAgent.id}:`;
    if (chatState.currentSessionKey.startsWith(expectedPrefix)) return;

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
  }, [projectPath, agents, switchSession]);

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
    const matchedAgent = agents.find((agent) => workspacePathMatches(agent.workspace, projectPath));
    if (matchedAgent) {
      const prefix = `agent:${matchedAgent.id}:`;
      return sessions.filter((session) => session.key.startsWith(prefix));
    }
    return sessions.filter((session) => projectBindings[session.key] === projectPath);
  }, [projectPath, sessions, projectBindings, agents]);
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
    if (!isEditorDragging.current) {
      setEditorWidth(persistedEditorWidth);
    }
  }, [persistedEditorWidth]);
  useEffect(() => {
    if (!isFileTreeDragging.current) {
      setFileTreeWidth(persistedFileTreeWidth);
    }
  }, [persistedFileTreeWidth]);
  const isChatPanelVisible = !isChatPanelCollapsed;
  const isFileTreeInlineVisible = !!projectPath && isFileTreeDrawerOpen && !isFileTreeDrawerMode;
  const effectiveFileTreeWidth = isFileTreeInlineVisible ? fileTreeWidth : 0;
  const panelWidthsRef = useRef({ editorWidth, fileTreeWidth });
  panelWidthsRef.current = { editorWidth, fileTreeWidth };
  const containerHorizontalPadding = isSessionDrawerMode
    ? CONTAINER_HORIZONTAL_PADDING_DRAWER
    : CONTAINER_HORIZONTAL_PADDING_INLINE;
  const fixedNonPanelWidth =
    (isSessionDrawerMode ? 0 : PROJECTS_RAIL_WIDTH) +
    (isChatPanelVisible ? RESIZE_HANDLE_WIDTH : 0) +
    (isFileTreeInlineVisible ? RESIZE_HANDLE_WIDTH : 0) +
    containerHorizontalPadding;

  const clampPanelsForViewport = useCallback(() => {
    if (isEditorDragging.current || isFileTreeDragging.current) return;
    const { editorWidth: currentEditorWidth, fileTreeWidth: currentFileTreeWidth } =
      panelWidthsRef.current;
    const containerWidth = containerRef.current?.clientWidth ?? window.innerWidth;
    const maxSidePanelsTotal = Math.max(
      0,
      containerWidth - (isChatPanelVisible ? CHAT_PANEL_SIZE.chat.min : 0) - fixedNonPanelWidth
    );

    const fileTreeMin = isFileTreeInlineVisible ? CHAT_PANEL_SIZE.fileTree.min : 0;
    const editorMin = CHAT_PANEL_SIZE.editor.min;

    let nextEditorWidth = Math.max(editorMin, currentEditorWidth);
    let nextFileTreeWidth = isFileTreeInlineVisible
      ? Math.max(fileTreeMin, currentFileTreeWidth)
      : 0;

    let overflow = nextEditorWidth + nextFileTreeWidth - maxSidePanelsTotal;
    if (overflow > 0) {
      const editorReduction = Math.min(overflow, Math.max(0, nextEditorWidth - editorMin));
      nextEditorWidth -= editorReduction;
      overflow -= editorReduction;
    }
    if (overflow > 0) {
      const fileTreeReduction = Math.min(overflow, Math.max(0, nextFileTreeWidth - fileTreeMin));
      nextFileTreeWidth -= fileTreeReduction;
      overflow -= fileTreeReduction;
    }

    // Extreme viewport shrink fallback: hide inline file tree first, then
    // allow editor to shrink below normal min to avoid horizontal overflow.
    if (overflow > 0 && isFileTreeInlineVisible) {
      setFileTreeDrawerOpen(false);
      const maxAfterHideFileTree = Math.max(
        0,
        containerWidth -
          (isChatPanelVisible ? CHAT_PANEL_SIZE.chat.min : 0) -
          (fixedNonPanelWidth - RESIZE_HANDLE_WIDTH)
      );
      nextFileTreeWidth = 0;
      overflow = nextEditorWidth - maxAfterHideFileTree;
      if (overflow > 0) {
        const emergencyEditorReduction = Math.min(
          overflow,
          Math.max(0, nextEditorWidth - EMERGENCY_EDITOR_MIN_WIDTH)
        );
        nextEditorWidth -= emergencyEditorReduction;
      }
    }
    if (Math.abs(nextEditorWidth - currentEditorWidth) > 0.5) {
      setEditorWidth(nextEditorWidth);
    }
    if (isFileTreeInlineVisible && Math.abs(nextFileTreeWidth - currentFileTreeWidth) > 0.5) {
      setFileTreeWidth(nextFileTreeWidth);
    }
  }, [isChatPanelVisible, isFileTreeInlineVisible, fixedNonPanelWidth, setFileTreeDrawerOpen]);

  useEffect(() => {
    clampPanelsForViewport();
    window.addEventListener('resize', clampPanelsForViewport);
    const observerTarget = containerRef.current;
    const observer =
      observerTarget != null
        ? new ResizeObserver(() => {
            clampPanelsForViewport();
          })
        : null;
    if (observer && observerTarget) {
      observer.observe(observerTarget);
    }
    return () => {
      window.removeEventListener('resize', clampPanelsForViewport);
      observer?.disconnect();
    };
  }, [clampPanelsForViewport]);

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

  const cancelPendingRafs = useCallback(() => {
    const editorRaf = editorRafRef.current;
    const fileTreeRaf = fileTreeRafRef.current;
    if (editorRaf != null) {
      window.cancelAnimationFrame(editorRaf);
    }
    if (fileTreeRaf != null) {
      window.cancelAnimationFrame(fileTreeRaf);
    }
  }, []);

  useEffect(() => cancelPendingRafs, [cancelPendingRafs]);

  const handleImportToEditor = useCallback(
    (content: string) => {
      if (activeFile) {
        updateFileContent(activeFile, content);
      }
    },
    [activeFile, updateFileContent]
  );

  const onEditorDragStart = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!isChatPanelVisible) return;
      isEditorDragging.current = true;
      setIsEditorResizing(true);
      editorDragStartX.current = event.clientX;
      editorDragStartWidth.current = editorWidth;
      const containerWidth = containerRef.current?.clientWidth ?? window.innerWidth;
      editorDragStartChatWidth.current =
        containerWidth - fixedNonPanelWidth - editorWidth - effectiveFileTreeWidth;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';

      const onMove = (ev: MouseEvent) => {
        if (!isEditorDragging.current) return;
        const delta = ev.clientX - editorDragStartX.current;
        const minDelta =
          (isChatPanelVisible ? CHAT_PANEL_SIZE.chat.min : 0) - editorDragStartChatWidth.current;
        const maxDelta = editorDragStartWidth.current - CHAT_PANEL_SIZE.editor.min;
        const clampedDelta = Math.max(minDelta, Math.min(maxDelta, delta));
        const nextWidth = editorDragStartWidth.current - clampedDelta;
        editorPendingWidthRef.current = nextWidth;
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
          commitEditorWidth(finalWidth);
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
    [isChatPanelVisible, editorWidth, effectiveFileTreeWidth, commitEditorWidth, fixedNonPanelWidth]
  );

  const onFileTreeDragStart = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!projectPath || !isFileTreeDrawerOpen || !isFileTreeInlineVisible) return;
      isFileTreeDragging.current = true;
      setIsFileTreeResizing(true);
      fileTreeDragStartX.current = event.clientX;
      fileTreeDragStartWidth.current = fileTreeWidth;
      editorDragStartWidth.current = editorWidth;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';

      const onMove = (ev: MouseEvent) => {
        if (!isFileTreeDragging.current) return;
        const delta = ev.clientX - fileTreeDragStartX.current;
        const editorStart = editorDragStartWidth.current;
        const fileTreeStart = fileTreeDragStartWidth.current;
        const minDelta = CHAT_PANEL_SIZE.editor.min - editorStart;
        const maxDelta = fileTreeStart - CHAT_PANEL_SIZE.fileTree.min;
        const clampedDelta = Math.max(minDelta, Math.min(maxDelta, delta));
        const nextEditorWidth = editorStart + clampedDelta;
        const nextFileTreeWidth = fileTreeStart - clampedDelta;
        fileTreePendingEditorWidthRef.current = nextEditorWidth;
        fileTreePendingWidthRef.current = nextFileTreeWidth;
        if (fileTreeRafRef.current == null) {
          fileTreeRafRef.current = window.requestAnimationFrame(() => {
            fileTreeRafRef.current = null;
            if (
              fileTreePendingEditorWidthRef.current != null &&
              fileTreePendingWidthRef.current != null
            ) {
              setEditorWidth(fileTreePendingEditorWidthRef.current);
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
        if (
          fileTreePendingEditorWidthRef.current != null &&
          fileTreePendingWidthRef.current != null
        ) {
          const finalEditorWidth = fileTreePendingEditorWidthRef.current;
          const finalFileTreeWidth = fileTreePendingWidthRef.current;
          setEditorWidth(finalEditorWidth);
          setFileTreeWidth(finalFileTreeWidth);
          commitEditorWidth(finalEditorWidth);
          commitFileTreeWidth(finalFileTreeWidth);
          fileTreePendingEditorWidthRef.current = null;
          fileTreePendingWidthRef.current = null;
        } else {
          commitEditorWidth(editorWidth);
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
      isFileTreeInlineVisible,
      editorWidth,
      fileTreeWidth,
      commitEditorWidth,
      commitFileTreeWidth,
    ]
  );

  const switchToProjectSession = useCallback(
    async (targetPath: string) => {
      const chatState = useChatStore.getState();
      const fsState = useFileSystemStore.getState();
      const matchingAgent = agents.find((agent) =>
        workspacePathMatches(agent.workspace, targetPath)
      );
      if (matchingAgent) {
        const targetPrefix = `agent:${matchingAgent.id}:`;
        const matchedSessionKey =
          [...chatState.sessions]
            .filter((session) => session.key.startsWith(targetPrefix))
            .sort(
              (a, b) =>
                (chatState.sessionLastActivity[b.key] ?? 0) -
                (chatState.sessionLastActivity[a.key] ?? 0)
            )[0]?.key ?? `${targetPrefix}main`;
        if (matchedSessionKey !== chatState.currentSessionKey) {
          chatState.switchSession(matchedSessionKey);
        }
        return;
      }

      const targetSessionKey =
        [...chatState.sessions]
          .filter((session) => fsState.projectBindings[session.key] === targetPath)
          .sort(
            (a, b) =>
              (chatState.sessionLastActivity[b.key] ?? 0) -
              (chatState.sessionLastActivity[a.key] ?? 0)
          )[0]?.key ?? null;

      if (targetSessionKey) {
        if (targetSessionKey !== chatState.currentSessionKey) {
          chatState.switchSession(targetSessionKey);
        }
        return;
      }

      chatState.newSession();
      const newSessionKey = useChatStore.getState().currentSessionKey;
      if (newSessionKey) {
        await fsState.bindProjectToSession(newSessionKey, targetPath);
      }
    },
    [agents]
  );

  const handleActivateProject = useCallback(
    async (targetPath: string) => {
      if (!targetPath || targetPath === useFileSystemStore.getState().projectPath) {
        navigate('/chat');
        return;
      }
      await switchToProjectSession(targetPath);
      await initProject(targetPath);
      navigate('/chat');
    },
    [initProject, navigate, switchToProjectSession]
  );

  useEffect(() => {
    const handleSwitchProject = (event: Event) => {
      const customEvent = event as CustomEvent<{ path?: string }>;
      const targetPath = customEvent.detail?.path;
      if (!targetPath) return;
      void handleActivateProject(targetPath);
    };
    window.addEventListener('project:switch-request', handleSwitchProject as EventListener);
    return () => {
      window.removeEventListener('project:switch-request', handleSwitchProject as EventListener);
    };
  }, [handleActivateProject]);

  useEffect(() => {
    const handleCloseProject = (event: Event) => {
      const customEvent = event as CustomEvent<{ path?: string }>;
      const targetPath = customEvent.detail?.path;
      if (!targetPath) return;
      setProjectToClose(targetPath);
    };
    window.addEventListener('project:close-request', handleCloseProject as EventListener);
    return () => {
      window.removeEventListener('project:close-request', handleCloseProject as EventListener);
    };
  }, []);

  const handleConfirmCloseCurrentProject = useCallback(async () => {
    if (!projectToClose) return;
    const target = projectToClose;
    setProjectToClose(null);
    const linkedAgents = useAgentsStore
      .getState()
      .agents.filter((agent) => workspacePathMatches(agent.workspace, target));
    try {
      for (const agent of linkedAgents) {
        await deleteAgent(agent.id);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(message || '删除关联 Agent 失败，已取消关闭 Project');
      return;
    }

    const targetAgentIds = new Set(linkedAgents.map((agent) => agent.id));
    const sessionsToDelete = useChatStore
      .getState()
      .sessions.filter((session) => {
        const boundByProject =
          useFileSystemStore.getState().projectBindings[session.key] === target;
        const sessionAgentId = session.key.startsWith('agent:') ? session.key.split(':')[1] : null;
        const boundByAgentWorkspace = sessionAgentId ? targetAgentIds.has(sessionAgentId) : false;
        return boundByProject || boundByAgentWorkspace;
      })
      .map((session) => session.key);
    for (const sessionKey of sessionsToDelete) {
      await deleteSession(sessionKey);
    }

    const isClosingCurrentProject = !!projectPath && workspacePathMatches(projectPath, target);
    const nextShortcuts = projectShortcuts.filter((item) => item !== target);
    removeProjectShortcut(target);
    if (isClosingCurrentProject && nextShortcuts.length > 0) {
      const nextProject = nextShortcuts[0];
      await switchToProjectSession(nextProject);
      await initProject(nextProject);
      return;
    }

    if (!isClosingCurrentProject) {
      return;
    }

    const remainingSessionKeys = useChatStore.getState().sessions.map((session) => session.key);
    for (const sessionKey of remainingSessionKeys) {
      await deleteSession(sessionKey);
    }
    resetChatRuntimeState();
    await clearProject();
  }, [
    projectToClose,
    deleteAgent,
    deleteSession,
    projectPath,
    projectShortcuts,
    removeProjectShortcut,
    switchToProjectSession,
    initProject,
    resetChatRuntimeState,
    clearProject,
  ]);

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

  useEffect(() => {
    const handleProjectCreateRequest = () => {
      window.dispatchEvent(new CustomEvent('project:create-dialog-open'));
    };
    window.addEventListener('project:create-request', handleProjectCreateRequest);
    return () => {
      window.removeEventListener('project:create-request', handleProjectCreateRequest);
    };
  }, []);

  if (!workspaceRoots.trim()) {
    return (
      <WorkspaceRootsRequiredScreen
        workspaceRoots={workspaceRoots}
        onPickWorkspaceRoot={() => void handlePickWorkspaceRoot()}
        onRemoveWorkspaceRoot={handleRemoveWorkspaceRoot}
      />
    );
  }

  if (!projectPath) {
    return <ProjectRequiredScreen onCreateProject={openCreateProjectDialog} />;
  }

  return (
    <div
      ref={containerRef}
      className={cn(
        'w-full min-w-0 max-w-full overflow-hidden px-3 py-3 pt-0 flex h-full transition-colors duration-500 dark:bg-background'
      )}
    >
      {/* Chat Panel */}
      <div
        className={cn(
          'rounded-2xl border relative flex flex-col overflow-hidden min-w-0',
          isChatPanelVisible ? 'flex-1' : 'w-0 border-none pointer-events-none'
        )}
      >
        {/* Toolbar */}
        <div className="flex shrink-0 items-center justify-start px-4 py-2">
          <ChatToolbar
            sessionBuckets={sessionBuckets}
            currentSessionKey={currentSessionKey}
            agentNameById={agentNameById}
            getAgentIdFromSessionKey={getAgentIdFromSessionKey}
            getSessionLabel={getSessionLabel}
            onCreateSession={() => void handleNewProjectSession()}
            onSelectSession={(sessionKey) => {
              switchSession(sessionKey);
              navigate('/');
              if (isSessionDrawerMode) {
                setSessionDrawerOpen(false);
              }
            }}
            onDeleteSession={({ key, label }) => {
              setSessionToDelete({ key, label });
            }}
          />
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
        {warning && (
          <div className="px-4 py-2 bg-yellow-500/10 border-t border-yellow-500/20">
            <div className="max-w-2xl mx-auto flex items-center justify-between">
              <p className="text-sm text-yellow-700 dark:text-yellow-400 flex items-center gap-2">
                <AlertCircle className="h-4 w-4" />
                {warning}
              </p>
              <button
                onClick={clearWarning}
                className="text-xs text-yellow-700/70 dark:text-yellow-400/70 hover:text-yellow-700 dark:hover:text-yellow-400 underline"
              >
                {t('common:actions.dismiss')}
              </button>
            </div>
          </div>
        )}

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

      {isChatPanelVisible && (
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
      )}

      {/* File Preview Panel */}
      <div
        className={cn(
          'group relative border rounded-2xl flex overflow-hidden min-w-0',
          isChatPanelVisible ? 'shrink-0' : 'flex-1 min-w-0'
        )}
        style={isChatPanelVisible ? { width: editorWidth } : undefined}
      >
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <div className="min-h-0 flex-1 overflow-hidden">
            <FilePreview
              activeFile={activeFile}
              fileContent={activeMarkdownContent}
              mdViewMode={mdViewMode}
              onMdViewModeChange={setMdViewMode}
              onMarkdownChange={handleMarkdownChange}
            />
          </div>
        </div>
      </div>

      {/* File Tree Panel */}
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
                  'transition-none',
                  isFileTreeInlineVisible
                    ? 'pointer-events-auto'
                    : 'w-0 pointer-events-none border-none'
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
                className="max-w-none py-3 pt-0 !border-none !rounded-none data-[vaul-drawer-direction=right]:top-10 data-[vaul-drawer-direction=right]:h-auto"
                style={{ width: `min(86vw, ${fileTreeWidth}px)` }}
              >
                <VisuallyHidden>
                  <DrawerTitle>File tree drawer</DrawerTitle>
                </VisuallyHidden>
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
      <ConfirmDialog
        open={!!projectToClose}
        title={t('common:actions.close')}
        message={
          projectToClose
            ? `确定关闭 Project「${getWorkspaceName(projectToClose)}」吗？这将同时删除与该工作区绑定的 Agent。`
            : ''
        }
        confirmLabel={t('common:actions.close')}
        cancelLabel={t('common:actions.cancel')}
        variant="destructive"
        onConfirm={() => {
          void handleConfirmCloseCurrentProject();
        }}
        onCancel={() => setProjectToClose(null)}
      />
    </div>
  );
}

// ── Welcome Screen ──────────────────────────────────────────────

function WelcomeScreen() {
  const featuredActions = [
    {
      key: 'book-breakdown',
      label: '一键拆书',
      desc: '章节结构拆解 · 核心要点提炼',
      prompt:
        '请帮我拆解一本书，输出：1）核心主题；2）章节结构；3）关键观点；4）可执行行动清单。并用清晰的小标题组织内容。',
    },
    {
      key: 'novel-writing',
      label: '小说创作',
      desc: '角色设定扩展 · 情节推进灵感',
      prompt:
        '我们开始小说创作：先给出世界观与主角设定，再提供三幕式大纲，并写出第一章开头（有冲突、有悬念）。',
    },
  ];

  return (
    <div className="flex flex-col items-center justify-center text-center h-[60vh]">
      <h1
        className="text-4xl md:text-5xl font-serif text-foreground/80 mb-8 font-normal tracking-tight"
        style={{ fontFamily: 'Georgia, Cambria, "Times New Roman", Times, serif' }}
      >
        写下一个脑洞，剩下交给我们
      </h1>

      <div className="mt-4 grid w-full max-w-xl grid-cols-2 gap-3">
        {featuredActions.map(({ key, label, desc, prompt }) => (
          <button
            key={key}
            onClick={() => {
              window.dispatchEvent(
                new CustomEvent('chat:prefill-input', {
                  detail: { prompt },
                })
              );
            }}
            className={cn(
              'group relative overflow-hidden rounded-2xl border',
              'px-4 py-3.5 text-left',
              'border-black/10 bg-white/70 dark:border-white/10 dark:bg-white/[0.02]',
              'shadow-[0_8px_24px_rgba(15,23,42,0.06)]',
              'hover:-translate-y-0.5 hover:shadow-[0_12px_28px_rgba(15,23,42,0.1)] hover:bg-white dark:hover:bg-white/[0.05] transition-all duration-200'
            )}
          >
            <div className="flex items-center justify-between">
              <span className="text-[15px] font-semibold text-foreground/90">{label}</span>
            </div>
            <p className="mt-1.5 text-[12px] leading-relaxed text-foreground/55">{desc}</p>
          </button>
        ))}
      </div>
    </div>
  );
}

function WorkspaceRootsRequiredScreen({
  workspaceRoots,
  onPickWorkspaceRoot,
  onRemoveWorkspaceRoot,
}: {
  workspaceRoots: string;
  onPickWorkspaceRoot: () => void;
  onRemoveWorkspaceRoot: () => void;
}) {
  const { t } = useTranslation(['chat', 'settings']);

  return (
    <div className="flex w-full h-full p-4 justify-center text-center">
      <div className="flex flex-col w-full rounded-2xl border items-center px-6 py-8">
        <h1 className="mt-[9%] bg-gradient-to-b from-zinc-400 via-zinc-700 to-black bg-clip-text text-[52px] font-bold text-transparent dark:from-zinc-200 dark:via-zinc-100 dark:to-white">
          {t('chat:workspaceRequired.title')}
        </h1>

        <div className="mt-8 w-full max-w-[520px] rounded-2xl border border-black/5 bg-black/[0.02] dark:border-white/8 dark:bg-white/[0.03] p-5 text-left">
          <h3 className="text-[13px] font-semibold text-muted-foreground uppercase tracking-wider">
            {t('settings:workspace.title')}
          </h3>
          <p className="mt-2 text-[12px] text-muted-foreground">{t('settings:workspace.desc')}</p>
          <div className="mt-3 space-y-2">
            {!workspaceRoots ? (
              <p className="text-[12px] text-muted-foreground">{t('settings:workspace.empty')}</p>
            ) : (
              <div className="flex items-center justify-between rounded-xl border border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5 px-3 py-2">
                <span className="text-[12px] font-mono text-foreground truncate flex-1 mr-2">
                  {workspaceRoots}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onRemoveWorkspaceRoot}
                  className="h-7 px-2 text-muted-foreground hover:text-red-500 hover:bg-red-500/10 shrink-0"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={onPickWorkspaceRoot}
            className="mt-4 rounded-xl h-9 px-4 border-black/10 dark:border-white/10 bg-transparent hover:bg-black/5 dark:hover:bg-white/5 text-[13px]"
          >
            <FolderPlus className="h-3.5 w-3.5 mr-1.5" />
            {t('settings:workspace.pick')}
          </Button>
        </div>
      </div>
    </div>
  );
}

function ProjectRequiredScreen({ onCreateProject }: { onCreateProject: () => void }) {
  const { t } = useTranslation('chat');
  return (
    <div className="flex w-full h-full p-4 justify-center text-center">
      <div className="flex flex-col w-full rounded-2xl border items-center justify-start">
        {/* <h1 className="mt-[15%] font-bold text-[52px]">Story Claw</h1>
        <div className="mt-10 text-sm text-muted-foreground">{t('projectRequired')}</div> */}
        <h1 className="mt-[12%] bg-gradient-to-b from-zinc-400 via-zinc-700 to-black bg-clip-text text-[62px] font-bold text-transparent dark:from-zinc-200 dark:via-zinc-100 dark:to-white">
          Story 
          <span className="inline-block ml-2 bg-gradient-to-b from-[#ed4141] to-[#c02b2b] bg-clip-text text-transparent">
            Claw
          </span>
        </h1>
        <p className="text-[22px] text-muted-foreground">{t('projectScreen.tagline')}</p>
        <Button className="relative mt-[32px] flex w-fit items-center gap-4 rounded-lg border border-[#c02b2b]/40 bg-gradient-to-r from-[#ed4141] to-[#c02b2b] px-8 py-7 text-xl font-bold text-white shadow-[0_10px_30px_rgba(192,43,43,0.28)] transition-all duration-300 hover:border-[#ed4141]/80 hover:from-[#f05555] hover:to-[#cf3838] hover:shadow-[0_14px_36px_rgba(192,43,43,0.36)]" onClick={onCreateProject}>
          <FolderPlus className="size-6" /> {t('projectScreen.createNow')}
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
