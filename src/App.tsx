/**
 * Root Application Component
 * Handles routing and global providers
 */
import { Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import { Component, useCallback, useEffect, useRef, useState } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { Toaster, toast } from 'sonner';
import i18n from './i18n';
import { MainLayout } from './components/layout/MainLayout';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Chat } from './pages/Chat';
import { Setup } from './pages/Setup';
import { Login } from './pages/Login';
import { useSettingsStore } from './stores/settings';
import { useGatewayStore } from './stores/gateway';
import { useLoginStore } from './stores/loginStore';
import { useProviderStore } from './stores/providers';
import { useAgentsStore } from './stores/agents';
import { useFileSystemStore } from './stores/filesystem';
import { useChatStore } from './stores/chat';
import { applyGatewayTransportPreference } from './lib/api-client';
import { invokeIpc } from '@/lib/api-client';
import { hostApiFetch } from '@/lib/host-api';
import { logClientEvent } from './lib/client-log';
import { useTranslation } from 'react-i18next';
import { AddAgentDialog } from './components/layout/AddAgentDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';

/**
 * Error Boundary to catch and display React rendering errors
 */
class ErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('React Error Boundary caught error:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            padding: '40px',
            color: '#f87171',
            background: '#0f172a',
            minHeight: '100vh',
            fontFamily: 'monospace',
          }}
        >
          <h1 style={{ fontSize: '24px', marginBottom: '16px' }}>Something went wrong</h1>
          <pre
            style={{
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
              background: '#1e293b',
              padding: '16px',
              borderRadius: '8px',
              fontSize: '14px',
            }}
          >
            {this.state.error?.message}
            {'\n\n'}
            {this.state.error?.stack}
          </pre>
          <button
            onClick={() => {
              this.setState({ hasError: false, error: null });
              window.location.reload();
            }}
            style={{
              marginTop: '16px',
              padding: '8px 16px',
              background: '#3b82f6',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
            }}
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function normalizeComparePath(inputPath: string): string {
  return inputPath
    .replace(/[\\/]+/g, '/')
    .replace(/\/+$/, '')
    .toLowerCase();
}

function ProjectCreateDialogHost() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const projectPath = useFileSystemStore((state) => state.projectPath);
  const workspaceRoots = useSettingsStore((state) => state.workspaceRoots);
  const createAgent = useAgentsStore((state) => state.createAgent);
  const addProjectShortcut = useFileSystemStore((state) => state.addProjectShortcut);
  const initProject = useFileSystemStore((state) => state.initProject);
  const agents = useAgentsStore((state) => state.agents);
  const [isAddingWorkspace, setIsAddingWorkspace] = useState(false);
  const [showAddProjectDialog, setShowAddProjectDialog] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [pendingProjectBaseName, setPendingProjectBaseName] = useState('');
  const [pendingOpenProjectPath, setPendingOpenProjectPath] = useState<string | null>(null);
  const [showAddAgentDialog, setShowAddAgentDialog] = useState(false);
  const openingProjectPickerRef = useRef(false);
  const openProjectAndCreateAgentRef = useRef<() => Promise<void>>(async () => {});
  const openCreateProjectDialogRef = useRef<() => void>(() => {});

  const recoverWorkspaceRootFromDisk = useCallback(async (): Promise<string> => {
    const currentRoot = useSettingsStore.getState().workspaceRoots.trim();
    if (currentRoot) return currentRoot;

    try {
      const result = await hostApiFetch<{ value?: unknown }>('/api/settings/workspaceRoots');
      const persistedRoot = typeof result?.value === 'string' ? result.value.trim() : '';
      if (!persistedRoot) return '';
      useSettingsStore.setState({ workspaceRoots: persistedRoot });
      return persistedRoot;
    } catch {
      return '';
    }
  }, []);

  const switchToProjectSession = useCallback(
    async (targetPath: string) => {
      const chatState = useChatStore.getState();
      const fsState = useFileSystemStore.getState();

      const matchingAgent = agents.find(
        (agent) => normalizeComparePath(agent.workspace) === normalizeComparePath(targetPath),
      );

      if (matchingAgent) {
        const agentSessions = [...chatState.sessions]
          .filter((session) => session.key.startsWith(`agent:${matchingAgent.id}:`))
          .sort(
            (a, b) =>
              (chatState.sessionLastActivity[b.key] ?? 0) -
              (chatState.sessionLastActivity[a.key] ?? 0),
          );

        const targetKey = agentSessions[0]?.key ?? `agent:${matchingAgent.id}:main`;
        if (targetKey !== chatState.currentSessionKey) {
          chatState.switchSession(targetKey);
        }
        return;
      }

      const targetSessions = [...chatState.sessions]
        .filter((session) => fsState.projectBindings[session.key] === targetPath)
        .sort(
          (a, b) =>
            (chatState.sessionLastActivity[b.key] ?? 0) -
            (chatState.sessionLastActivity[a.key] ?? 0),
        );

      if (targetSessions.length > 0) {
        const targetSessionKey = targetSessions[0].key;
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
    [agents],
  );

  const openCreateProjectDialog = useCallback(() => {
    const currentPath = window.location.pathname;
    const isOnChatRoute = currentPath === '/' || currentPath === '/chat';
    if (!isOnChatRoute) {
      navigate('/chat');
    }
    setPendingOpenProjectPath(null);
    setShowAddProjectDialog(true);
  }, [navigate]);

  const openProjectAndCreateAgent = useCallback(async () => {
    if (openingProjectPickerRef.current) return;
    openingProjectPickerRef.current = true;
    try {
      const result = await invokeIpc<{ canceled: boolean; filePaths?: string[] }>('dialog:open', {
        properties: ['openDirectory'],
        defaultPath: projectPath || workspaceRoots || undefined,
      });
      if (result.canceled || !result.filePaths?.length) return;
      const selected = result.filePaths[0];
      const currentPath = window.location.pathname;
      const isOnChatRoute = currentPath === '/' || currentPath === '/chat';
      if (!isOnChatRoute) {
        navigate('/chat');
      }
      setPendingProjectBaseName('');
      setPendingOpenProjectPath(selected);
      setShowAddProjectDialog(false);
      setShowAddAgentDialog(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(message || '打开项目失败');
    } finally {
      openingProjectPickerRef.current = false;
    }
  }, [navigate, projectPath, workspaceRoots]);

  // Keep refs in sync so the stable event listeners always call the latest version
  openProjectAndCreateAgentRef.current = openProjectAndCreateAgent;
  openCreateProjectDialogRef.current = openCreateProjectDialog;

  useEffect(() => {
    const handleCreateRequest = () => openCreateProjectDialogRef.current();
    const handleCreateDialogOpen = () => openCreateProjectDialogRef.current();
    const handleOpenProjectRequest = () => { void openProjectAndCreateAgentRef.current(); };
    window.addEventListener('project:create-request', handleCreateRequest);
    window.addEventListener('project:create-dialog-open', handleCreateDialogOpen);
    window.addEventListener('project:open-request', handleOpenProjectRequest);
    return () => {
      window.removeEventListener('project:create-request', handleCreateRequest);
      window.removeEventListener('project:create-dialog-open', handleCreateDialogOpen);
      window.removeEventListener('project:open-request', handleOpenProjectRequest);
    };
  }, []);

  const handleConfirmProjectName = async () => {
    const allowedRoot = (await recoverWorkspaceRootFromDisk()) || workspaceRoots?.trim() || '';
    if (!allowedRoot) {
      toast.error('请先在设置中配置可用工作区');
      return;
    }

    const rawName = newProjectName;
    if (/^\s/.test(rawName)) {
      toast.error('Project 名称不能以空格开头');
      return;
    }

    const normalizedName = rawName.trim();
    if (!normalizedName) {
      toast.error('请输入 Project 名称');
      return;
    }
    if (/[<>:"/\\|*?]/.test(normalizedName)) {
      toast.error('Project 名称不能包含以下字符：< > : " / \\ | * ?');
      return;
    }

    setPendingProjectBaseName(normalizedName);
    setShowAddProjectDialog(false);
    setShowAddAgentDialog(true);
  };

  const handleCreateAgentAndProject = async (
    name: string,
    options: { templateId?: string; sourceAgentId?: string; workspacePath?: string },
  ) => {
    if (pendingOpenProjectPath) {
      setIsAddingWorkspace(true);
      try {
        const selected = pendingOpenProjectPath;
        const beforeIds = new Set(useAgentsStore.getState().agents.map((agent) => agent.id));
        await createAgent(name, { ...options, workspacePath: selected });
        const afterAgents = useAgentsStore.getState().agents;
        const createdAgent =
          afterAgents.find((agent) => !beforeIds.has(agent.id)) ??
          afterAgents.find(
            (agent) =>
              normalizeComparePath(agent.workspace) === normalizeComparePath(selected) &&
              agent.name === name,
          );
        if (!createdAgent) {
          throw new Error('创建 Agent 后无法定位对应会话');
        }

        await useFileSystemStore
          .getState()
          .bindProjectToSession(createdAgent.mainSessionKey, selected);

        addProjectShortcut(selected);
        await invokeIpc<string>('fs:set-workspace', selected);
        await switchToProjectSession(selected);
        await initProject(selected);
        setShowAddAgentDialog(false);
        setPendingOpenProjectPath(null);
        setPendingProjectBaseName('');
        setNewProjectName('');
        navigate('/chat');
        toast.success(t('common:status.agentCreated'));
      } catch (error) {
        console.error(error);
        toast.error(t('common:projectDialog.error'), { position: 'top-center' });
      } finally {
        setIsAddingWorkspace(false);
      }
      return;
    }

    const allowedRoot = (await recoverWorkspaceRootFromDisk()) || workspaceRoots?.trim() || '';
    if (!allowedRoot) {
      toast.error('请先在设置中配置可用工作区');
      return;
    }
    const baseName = pendingProjectBaseName.trim();
    if (!baseName) {
      toast.error('请输入 Project 名称');
      return;
    }

    const joinPath = (root: string, child: string): string => {
      const separator = root.includes('\\') ? '\\' : '/';
      const normalizedRoot = root.replace(/[\\/]+$/, '');
      return `${normalizedRoot}${separator}${child}`;
    };
    const isAlreadyExistsError = (error: unknown): boolean => {
      const message = error instanceof Error ? error.message : String(error);
      const normalized = message.toLowerCase();
      return normalized.includes('exist') || normalized.includes('already');
    };

    setIsAddingWorkspace(true);
    try {
      await invokeIpc<string>('fs:set-workspace', allowedRoot);

      let suffix = 0;
      let selected = '';
      while (suffix < 10_000) {
        const candidateName = suffix === 0 ? baseName : `${baseName}-${suffix}`;
        const candidatePath = joinPath(allowedRoot, candidateName);
        try {
          await invokeIpc<unknown>('fs:read-tree', candidatePath);
          suffix += 1;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const normalized = message.toLowerCase();
          if (normalized.includes('enoent') || normalized.includes('no such file')) {
            selected = candidatePath;
            break;
          }
          throw error;
        }
      }

      if (!selected) {
        toast.error('创建 Project 失败，请更换名称后重试');
        return;
      }

      const beforeIds = new Set(useAgentsStore.getState().agents.map((agent) => agent.id));
      await createAgent(name, { ...options, workspacePath: selected });
      const afterAgents = useAgentsStore.getState().agents;
      const createdAgent =
        afterAgents.find((agent) => !beforeIds.has(agent.id)) ??
        afterAgents.find(
          (agent) =>
            normalizeComparePath(agent.workspace) === normalizeComparePath(selected) &&
            agent.name === name,
        );
      if (!createdAgent) {
        throw new Error('创建 Agent 后无法定位对应会话');
      }

      await useFileSystemStore
        .getState()
        .bindProjectToSession(createdAgent.mainSessionKey, selected);

      try {
        // createAgent flow may alter workspace context in main process.
        // Re-pin to project root before creating child folder.
        await invokeIpc<string>('fs:set-workspace', allowedRoot);
        await invokeIpc<boolean>('fs:create-folder', selected);
      } catch (error) {
        if (!isAlreadyExistsError(error)) {
          throw error;
        }
      }

      await invokeIpc<string>('fs:set-workspace', selected);
      await switchToProjectSession(selected);
      await initProject(selected);
      addProjectShortcut(selected);
      setShowAddAgentDialog(false);
      setPendingOpenProjectPath(null);
      setPendingProjectBaseName('');
      setNewProjectName('');
      navigate('/chat');
      toast.success(t('common:status.agentCreated'));
    } catch (error) {
      console.error(error);
      toast.error(t('common:projectDialog.error'), { position: 'top-center' });
    } finally {
      setIsAddingWorkspace(false);
    }
  };

  return (
    <>
      <AddAgentDialog
        open={showAddAgentDialog}
        onClose={() => {
          setShowAddAgentDialog(false);
          setPendingOpenProjectPath(null);
          setPendingProjectBaseName('');
        }}
        hideWorkspaceSelector
        onCreate={handleCreateAgentAndProject}
      />
      <Dialog
        open={showAddProjectDialog}
        onOpenChange={(open) => {
          setShowAddProjectDialog(open);
          if (!open) {
            setNewProjectName('');
            setPendingProjectBaseName('');
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogTitle>{t('common:projectDialog.title')}</DialogTitle>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">{t('common:projectDialog.description')}</p>
            <Input
              autoFocus
              value={newProjectName}
              onChange={(event) => setNewProjectName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void handleConfirmProjectName();
                }
              }}
              maxLength={200}
              placeholder={t('common:projectDialog.placeholder')}
              disabled={isAddingWorkspace}
            />
            <div className="flex items-center justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => setShowAddProjectDialog(false)}
                disabled={isAddingWorkspace}
              >
                {t('common:actions.cancel')}
              </Button>
              <Button onClick={() => void handleConfirmProjectName()} disabled={isAddingWorkspace}>
                {isAddingWorkspace
                  ? t('common:projectDialog.creating')
                  : t('common:projectDialog.create')}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const initSettings = useSettingsStore((state) => state.init);
  const theme = useSettingsStore((state) => state.theme);
  const language = useSettingsStore((state) => state.language);
  const setupComplete = useSettingsStore((state) => state.setupComplete);
  const initGateway = useGatewayStore((state) => state.init);

  const isLoggedIn = useLoginStore((state) => state.isLoggedIn);
  const ensureBaowenmaoPresetAccounts = useProviderStore((state) => state.ensureBaowenmaoPresetAccounts);

  const initProviders = useProviderStore((state) => state.init);


  useEffect(() => {
    initSettings();
  }, [initSettings]);

  // Sync i18n language with persisted settings on mount
  useEffect(() => {
    if (language && language !== i18n.language) {
      i18n.changeLanguage(language);
    }
  }, [language]);

  // Initialize Gateway connection on mount
  useEffect(() => {
    initGateway();
  }, [initGateway]);


  // 已登录时同步 baowenmao preset accounts，确保重启后 provider 配置是最新的

  // Initialize provider snapshot on mount
  useEffect(() => {
    initProviders();
  }, [initProviders]);

  useEffect(() => {
    if (!isLoggedIn) return;
    const token = localStorage.getItem('token');
    if (!token) return;
    void ensureBaowenmaoPresetAccounts(token).catch((err) => {
      console.error('Failed to sync Baowenmao preset accounts on startup:', err);
    });
  }, [isLoggedIn, ensureBaowenmaoPresetAccounts]);

  // Routing guard: Login → Setup → Main
  useEffect(() => {
    const path = location.pathname;

    // 1. 未登录 → 强制登录页（/login 和 /setup 除外，setup 不应在未登录时访问，但不强制跳走避免死循环）
    if (!isLoggedIn && !path.startsWith('/login')) {
      logClientEvent('info', {
        source: 'app.route-guard',
        message: 'Redirect unauthenticated user to /login',
        data: { path, isLoggedIn, setupComplete },
      });
      navigate('/login');
      return;
    }

    // Setup flow is currently disabled:
    // - OpenClaw preset/provider setup is performed automatically after login.
    // - Keep this block commented for potential future re-enable.
    //
    // // 2. 已登录但 setup 未完成 → 强制 setup
    // if (isLoggedIn && !setupComplete && !path.startsWith('/setup')) {
    //   logClientEvent('info', {
    //     source: 'app.route-guard',
    //     message: 'Redirect authenticated user to /setup',
    //     data: { path, isLoggedIn, setupComplete },
    //   });
    //   navigate('/setup');
    //   return;
    // }

    // 2. 已登录后，不再展示 setup。访问 /login 或 /setup 统一回到主界面
    if (isLoggedIn && (path.startsWith('/login') || path.startsWith('/setup'))) {
      logClientEvent('info', {
        source: 'app.route-guard',
        message: 'Redirect authenticated user to /',
        data: { path, isLoggedIn, setupComplete },
      });
      navigate('/');
    }
  }, [isLoggedIn, setupComplete, location.pathname, navigate]);

  // Listen for navigation events from main process
  useEffect(() => {
    const handleNavigate = (...args: unknown[]) => {
      const path = args[0];
      if (typeof path === 'string') {
        navigate(path);
      }
    };

    const unsubscribe = window.electron.ipcRenderer.on('navigate', handleNavigate);

    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, [navigate]);

  // Apply theme
  useEffect(() => {
    const root = window.document.documentElement;
    root.classList.remove('light', 'dark');

    if (theme === 'system') {
      const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light';
      root.classList.add(systemTheme);
    } else {
      root.classList.add(theme);
    }
  }, [theme]);

  useEffect(() => {
    applyGatewayTransportPreference();
  }, []);

  return (
    <ErrorBoundary>
      <TooltipProvider delayDuration={300}>
        <Routes>
          {/* Setup wizard (shown on first launch) */}
          <Route path="/setup/*" element={<Setup />} />

          {/* Login page */}
          <Route path="/login" element={<Login />} />

          {/* Main application routes */}
          <Route element={<MainLayout />}>
            <Route path="/" element={<Chat />} />
            <Route path="/chat" element={<Chat />} />

            {/* <Route path="/models" element={<Models />} />
            <Route path="/agents" element={<Agents />} />
            <Route path="/channels" element={<Channels />} />
            <Route path="/skills" element={<Skills />} />
            <Route path="/cron" element={<Cron />} />
            <Route path="/settings/*" element={<Settings />} />
            <Route path="/preferences" element={<Preferences />} /> */}
          </Route>
        </Routes>

        {/* Global toast notifications */}
        <Toaster position="bottom-right" richColors closeButton style={{ zIndex: 99999 }} />
        <ProjectCreateDialogHost />
      </TooltipProvider>
    </ErrorBoundary>
  );
}

export default App;
