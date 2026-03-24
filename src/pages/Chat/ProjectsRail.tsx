import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui/button.tsx';
import { Input } from '@/components/ui/input.tsx';
import { ConfirmDialog } from '@/components/ui/confirm-dialog.tsx';
import { AddAgentDialog } from '../../components/layout/AddAgentDialog.tsx';
import { invokeIpc } from '@/lib/api-client.ts';
import { cn } from '@/lib/utils.ts';
import { useAgentsStore } from '@/stores/agents.ts';
import { useChatStore } from '@/stores/chat.ts';
import { useFileSystemStore } from '@/stores/filesystem.ts';
import { useSettingsStore } from '@/stores/settings.ts';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog.tsx';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover.tsx';
// import { useSettingDialogStore } from '@/stores/setting-dialog.ts';

type ProjectItem = {
  path: string;
  initial: string;
  name: string;
  theme: {
    bg: string;
    text: string;
    border: string;
  };
  isActive: boolean;
};

type ProjectBadgeTheme = {
  bg: string;
  text: string;
  border: string;
};

type PersistedProjectStateBackup = {
  projectPath: string | null;
  defaultProjectPath: string | null;
  projectBindings: Record<string, string>;
  projectShortcuts: string[];
};

const PROJECT_THEMES: ProjectBadgeTheme[] = [
  { bg: '#e1fbf4', text: '#147d7c', border: '#b9efe4' },
  { bg: '#e8f1ff', text: '#1d4ed8', border: '#c9dcff' },
  { bg: '#fff1e5', text: '#b45309', border: '#ffd9b2' },
  { bg: '#f3e8ff', text: '#7e22ce', border: '#e4ccff' },
  { bg: '#ffe9ef', text: '#be185d', border: '#ffcddd' },
  { bg: '#ecfeff', text: '#0e7490', border: '#c7f5ff' },
  { bg: '#f0fdf4', text: '#15803d', border: '#c8f5d5' },
  { bg: '#fff7ed', text: '#c2410c', border: '#ffe3c2' },
];

type ContextMenuState = {
  workspacePath: string;
  x: number;
  y: number;
};

function getWorkspaceName(workspacePath: string): string {
  const normalized = workspacePath.replace(/[\\/]+$/, '');
  const segments = normalized.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] || workspacePath;
}

function getWorkspaceInitial(workspacePath: string): string {
  const name = getWorkspaceName(workspacePath).trim();
  return (name.charAt(0) || '?').toUpperCase();
}

function hashFromSeed(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function getWorkspaceTheme(workspacePath: string): ProjectBadgeTheme {
  const initial = getWorkspaceInitial(workspacePath);
  const themeIndex = hashFromSeed(`${initial}:${workspacePath}`) % PROJECT_THEMES.length;
  return PROJECT_THEMES[themeIndex];
}

function normalizeComparePath(inputPath: string): string {
  return inputPath
    .replace(/[\\/]+/g, '/')
    .replace(/\/+$/, '')
    .toLowerCase();
}

export function ProjectsRail() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  // const openSettingDialog = useSettingDialogStore((state) => state.openDialog);
  const projectPath = useFileSystemStore((state) => state.projectPath);
  const initProject = useFileSystemStore((state) => state.initProject);
  const clearProject = useFileSystemStore((state) => state.clearProject);
  const projectShortcuts = useFileSystemStore((state) => state.projectShortcuts);
  const initProjectShortcuts = useFileSystemStore((state) => state.initProjectShortcuts);
  const addProjectShortcut = useFileSystemStore((state) => state.addProjectShortcut);
  const removeProjectShortcut = useFileSystemStore((state) => state.removeProjectShortcut);
  const workspaceRoots = useSettingsStore((state) => state.workspaceRoots);
  const createAgent = useAgentsStore((state) => state.createAgent);
  const deleteAgent = useAgentsStore((state) => state.deleteAgent);
  const [menuState, setMenuState] = useState<ContextMenuState | null>(null);
  const [projectToClose, setProjectToClose] = useState<string | null>(null);
  const [isAddingWorkspace, setIsAddingWorkspace] = useState(false);
  const [showAddProjectDialog, setShowAddProjectDialog] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [pendingProjectBaseName, setPendingProjectBaseName] = useState('');
  const [showAddAgentDialog, setShowAddAgentDialog] = useState(false);
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);

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

  const recoverProjectShortcutsFromDisk = useCallback(async () => {
    const currentShortcuts = useFileSystemStore.getState().projectShortcuts;
    if (currentShortcuts.length > 0) return;

    try {
      const backup = await invokeIpc<PersistedProjectStateBackup | null>('fs:project-state:get');
      if (!backup?.projectShortcuts?.length) return;
      backup.projectShortcuts.forEach((shortcutPath) => {
        if (typeof shortcutPath === 'string' && shortcutPath.trim()) {
          addProjectShortcut(shortcutPath);
        }
      });
    } catch {
      // Ignore restore errors and keep runtime state unchanged.
    }
  }, [addProjectShortcut]);

  const projectItems = useMemo<ProjectItem[]>(
    () =>
      projectShortcuts.map((path) => ({
        path,
        initial: getWorkspaceInitial(path),
        name: getWorkspaceName(path),
        theme: getWorkspaceTheme(path),
        isActive: path === projectPath,
      })),
    [projectPath, projectShortcuts]
  );

  useEffect(() => {
    initProjectShortcuts();
  }, [initProjectShortcuts]);

  useEffect(() => {
    void recoverWorkspaceRootFromDisk();
    void recoverProjectShortcutsFromDisk();
  }, [recoverProjectShortcutsFromDisk, recoverWorkspaceRootFromDisk]);

  useEffect(() => {
    if (!projectPath) return;
    addProjectShortcut(projectPath);
  }, [projectPath, addProjectShortcut]);

  useEffect(() => {
    const closeMenu = () => setMenuState(null);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuState(null);
      }
    };

    window.addEventListener('mousedown', closeMenu);
    window.addEventListener('scroll', closeMenu, true);
    window.addEventListener('resize', closeMenu);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mousedown', closeMenu);
      window.removeEventListener('scroll', closeMenu, true);
      window.removeEventListener('resize', closeMenu);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  useEffect(() => {
    const openCreateProjectDialog = () => setShowAddProjectDialog(true);
    window.addEventListener('project:create-request', openCreateProjectDialog);
    return () => {
      window.removeEventListener('project:create-request', openCreateProjectDialog);
    };
  }, []);

  const handleContextMenu = (event: React.MouseEvent, targetPath: string) => {
    event.preventDefault();
    event.stopPropagation();
    setMenuState({
      workspacePath: targetPath,
      x: event.clientX,
      y: event.clientY,
    });
  };

  const agents = useAgentsStore((state) => state.agents);

  const switchToProjectSession = useCallback(
    async (targetPath: string) => {
      const chatState = useChatStore.getState();
      const fsState = useFileSystemStore.getState();

      // Prefer agent-based routing: match workspace path to a known agent.
      const matchingAgent = agents.find(
        (a) => normalizeComparePath(a.workspace) === normalizeComparePath(targetPath)
      );

      if (matchingAgent) {
        // Find the most recent session for this agent by key prefix.
        const agentSessions = [...chatState.sessions]
          .filter((s) => s.key.startsWith(`agent:${matchingAgent.id}:`))
          .sort(
            (a, b) =>
              (chatState.sessionLastActivity[b.key] ?? 0) -
              (chatState.sessionLastActivity[a.key] ?? 0)
          );

        const targetKey = agentSessions[0]?.key ?? `agent:${matchingAgent.id}:main`;
        if (targetKey !== chatState.currentSessionKey) {
          chatState.switchSession(targetKey);
        }
        return;
      }

      // Non-agent workspace: fall back to projectBindings lookup.
      const targetSessions = [...chatState.sessions]
        .filter((session) => fsState.projectBindings[session.key] === targetPath)
        .sort(
          (a, b) =>
            (chatState.sessionLastActivity[b.key] ?? 0) -
            (chatState.sessionLastActivity[a.key] ?? 0)
        );

      if (targetSessions.length > 0) {
        const nextSessionKey = targetSessions[0].key;
        if (nextSessionKey !== chatState.currentSessionKey) {
          chatState.switchSession(nextSessionKey);
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

  const handleOpenProject = useCallback(async () => {
    try {
      const result = await invokeIpc<{ canceled: boolean; filePaths?: string[] }>('dialog:open', {
        properties: ['openDirectory'],
        defaultPath: projectPath || workspaceRoots || undefined,
      });
      if (result.canceled || !result.filePaths?.length) return;
      const selected = result.filePaths[0];
      addProjectShortcut(selected);
      await handleActivateProject(selected);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(message || '打开项目失败');
    }
  }, [addProjectShortcut, handleActivateProject, projectPath, workspaceRoots]);

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
    const handleOpenProjectRequest = () => {
      void handleOpenProject();
    };
    window.addEventListener('project:open-request', handleOpenProjectRequest as EventListener);
    return () => {
      window.removeEventListener('project:open-request', handleOpenProjectRequest as EventListener);
    };
  }, [handleOpenProject]);

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
    options: { templateId?: string; sourceAgentId?: string; workspacePath?: string }
  ) => {
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
            agent.name === name
        );
      if (!createdAgent) {
        throw new Error('创建 Agent 后无法定位对应会话');
      }

      await useFileSystemStore
        .getState()
        .bindProjectToSession(createdAgent.mainSessionKey, selected);

      try {
        await invokeIpc<boolean>('fs:create-folder', selected);
      } catch (error) {
        if (!isAlreadyExistsError(error)) {
          throw error;
        }
      }

      await switchToProjectSession(selected);
      await initProject(selected);
      addProjectShortcut(selected);
      setShowAddAgentDialog(false);
      setPendingProjectBaseName('');
      setNewProjectName('');
      toast.success(t('common:status.agentCreated'));
    } catch (error) {
      console.error(error);
      toast.error(t('common:projectDialog.error'), { position: 'top-center' });
    } finally {
      setIsAddingWorkspace(false);
    }
  };

  const handleClose = () => {
    if (!menuState) return;
    setProjectToClose(menuState.workspacePath);
    setMenuState(null);
  };

  const handleConfirmClose = async () => {
    if (!projectToClose) return;
    const target = projectToClose;
    setProjectToClose(null);
    const resetChatViewState = () => {
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
    };
    const linkedAgents = useAgentsStore
      .getState()
      .agents.filter((agent) => normalizeComparePath(agent.workspace) === normalizeComparePath(target));
    const targetAgentIds = new Set(linkedAgents.map((agent) => agent.id));
    try {
      for (const agent of linkedAgents) {
        await deleteAgent(agent.id);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(message || '删除关联 Agent 失败，已取消关闭 Project');
      return;
    }

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
      await useChatStore.getState().deleteSession(sessionKey);
    }
    if (projectPath === target) {
      resetChatViewState();
    }
    const nextShortcuts = projectShortcuts.filter((item) => item !== target);
    removeProjectShortcut(target);

    if (projectPath === target && nextShortcuts.length > 0) {
      const nextProject = nextShortcuts[0];
      await switchToProjectSession(nextProject);
      await initProject(nextProject);
      return;
    }

    if (projectPath === target && nextShortcuts.length === 0) {
      // No projects remain: clear all sessions so session state never points to
      // a stale workspace and matches the "session must bind to project" rule.
      const remainingSessionKeys = useChatStore.getState().sessions.map((session) => session.key);
      for (const sessionKey of remainingSessionKeys) {
        await useChatStore.getState().deleteSession(sessionKey);
      }
      resetChatViewState();
      await clearProject();
    }
  };

  const handleOpenInFileExplorer = useCallback(async () => {
    if (!menuState?.workspacePath) return;
    const target = menuState.workspacePath;
    setMenuState(null);
    try {
      await invokeIpc('shell:openPath', target);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(message || 'Failed to open project folder');
    }
  }, [menuState]);

  return (
    <>
      <div className="flex w-3 h-full flex-col items-center gap-0 py-0 px-0 shrink-0">
        <div className="hidden">
          <Popover open={projectMenuOpen} onOpenChange={setProjectMenuOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className={cn(
                  'h-8 w-full rounded-md border border-[#77d18a]/70 bg-[#e9fbe8] px-2',
                  'text-[12px] font-semibold text-[#157a2e] flex items-center justify-between gap-1',
                  'hover:bg-[#dff7de] transition-colors'
                )}
                title={projectPath || 'Select Project'}
              >
                <span className="truncate">{projectPath ? getWorkspaceName(projectPath) : 'Project'}</span>
                <ChevronDown className="h-3.5 w-3.5 shrink-0" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-64 p-1">
              <div className="max-h-[420px] overflow-y-auto space-y-1">
                {projectItems.map((project) => (
                  <button
                    key={project.path}
                    type="button"
                    title={project.path}
                    onClick={() => {
                      void handleActivateProject(project.path);
                      setProjectMenuOpen(false);
                    }}
                    onContextMenu={(event) => handleContextMenu(event, project.path)}
                    className={cn(
                      'w-full rounded-md px-2 py-1.5 text-left text-sm transition-colors',
                      'hover:bg-black/5 dark:hover:bg-white/10',
                      project.isActive ? 'bg-black/5 dark:bg-white/10 font-medium' : 'text-foreground/80'
                    )}
                  >
                    <div className="truncate">{project.name}</div>
                    <div className="truncate text-[11px] text-muted-foreground">{project.path}</div>
                  </button>
                ))}
              </div>
              <div className="mt-1 border-t pt-1">
                <button
                  type="button"
                  className="w-full rounded-md px-2 py-1.5 text-left text-sm font-medium hover:bg-black/5 dark:hover:bg-white/10"
                  disabled={isAddingWorkspace}
                  onClick={() => {
                    setShowAddProjectDialog(true);
                    setProjectMenuOpen(false);
                  }}
                >
                  + {t('common:projectDialog.title')}
                </button>
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {menuState && (
        <div
          className="fixed z-[100] min-w-[110px] rounded-md border border-black/10 dark:border-white/10 bg-popover p-1 shadow-lg"
          style={{ left: menuState.x, top: menuState.y }}
          onMouseDown={(event) => event.stopPropagation()}
        >
          {/* <button
            type="button"
            onClick={() => void handleEdit()}
            className="w-full rounded px-2 py-1.5 text-left text-sm hover:bg-black/5 dark:hover:bg-white/10"
          >
            编辑
          </button> */}
          <button
            type="button"
            onClick={() => void handleOpenInFileExplorer()}
            className="w-full rounded px-2 py-1.5 text-left font-bold text-sm hover:bg-black/5 dark:hover:bg-white/10"
          >
            {t('common:actions.openInFileExplorer')}
          </button>
          <button
            type="button"
            onClick={() => void handleClose()}
            className="w-full rounded px-2 py-1.5 text-left font-bold text-sm hover:bg-black/5 dark:hover:bg-white/10"
          >
            {t('common:actions.close')}
          </button>
        </div>
      )}

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
          void handleConfirmClose();
        }}
        onCancel={() => setProjectToClose(null)}
      />

      <AddAgentDialog
        open={showAddAgentDialog}
        onClose={() => {
          setShowAddAgentDialog(false);
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
