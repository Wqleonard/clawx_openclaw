import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { SettingsIcon, SlidersHorizontal, Terminal } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Button } from '../ui/button';
import { Input } from '@/components/ui/input';
import { AddAgentDialog } from './AddAgentDialog';
import { invokeIpc } from '@/lib/api-client';
import { hostApiFetch } from '@/lib/host-api';
import { cn } from '@/lib/utils';
import { useAgentsStore } from '@/stores/agents';
import { useChatStore } from '@/stores/chat';
import { useFileSystemStore } from '@/stores/filesystem';
import { useSettingsStore } from '@/stores/settings';
import { Dialog, DialogContent, DialogTitle, VisuallyHidden } from '@/components/ui/dialog';
import { Preferences } from '@/pages/Preferences';
import { useSettingDialogStore } from '@/stores/setting-dialog';

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

type WorkspaceShortcutButtonProps = {
  workspace: ProjectItem;
  onActivate: (workspacePath: string) => Promise<void>;
  onContextMenu: (event: React.MouseEvent, workspacePath: string) => void;
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

function WorkspaceShortcutButton({
  workspace,
  onActivate,
  onContextMenu,
}: WorkspaceShortcutButtonProps) {
  return (
    <button
      key={workspace.path}
      title={workspace.path}
      type="button"
      aria-label={`Switch to workspace ${workspace.name}`}
      onClick={() => void onActivate(workspace.path)}
      onContextMenu={(event) => onContextMenu(event, workspace.path)}
      className={cn(
        'size-10 rounded-lg p-0.5 flex items-center justify-center border-2',
        workspace.isActive ? 'border-[var(--workspace-active-border)]' : 'border-transparent'
      )}
    >
      <div
        className="size-full rounded-sm border text-sm font-semibold flex items-center justify-center"
        style={{
          backgroundColor: workspace.theme.bg,
          color: workspace.theme.text,
          borderColor: workspace.theme.border,
        }}
      >
        {workspace.initial}
      </div>
    </button>
  );
}

export function ProjectsRail() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const openSettingDialog = useSettingDialogStore((state) => state.openDialog);
  const projectPath = useFileSystemStore((state) => state.projectPath);
  const initProject = useFileSystemStore((state) => state.initProject);
  const clearProject = useFileSystemStore((state) => state.clearProject);
  const projectShortcuts = useFileSystemStore((state) => state.projectShortcuts);
  const initProjectShortcuts = useFileSystemStore((state) => state.initProjectShortcuts);
  const addProjectShortcut = useFileSystemStore((state) => state.addProjectShortcut);
  const removeProjectShortcut = useFileSystemStore((state) => state.removeProjectShortcut);
  const workspaceRoots = useSettingsStore((state) => state.workspaceRoots);
  const createAgent = useAgentsStore((state) => state.createAgent);
  const [menuState, setMenuState] = useState<ContextMenuState | null>(null);
  const [isAddingWorkspace, setIsAddingWorkspace] = useState(false);
  const [showAddProjectDialog, setShowAddProjectDialog] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [pendingProjectBaseName, setPendingProjectBaseName] = useState('');
  const [showAddAgentDialog, setShowAddAgentDialog] = useState(false);
  const [preferencesOpen, setPreferencesOpen] = useState(false);

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

  const handleActivateProject = async (targetPath: string) => {
    if (!targetPath || targetPath === useFileSystemStore.getState().projectPath) {
      navigate('/chat');
      return;
    }
    await switchToProjectSession(targetPath);
    await initProject(targetPath);
    navigate('/chat');
  };

  const handleConfirmProjectName = async () => {
    const allowedRoot = workspaceRoots?.trim() ?? '';
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
    const allowedRoot = workspaceRoots?.trim() ?? '';
    if (!allowedRoot) {
      toast.error('请先在设置中配置可用工作区');
      return;
    }
    const baseName = pendingProjectBaseName.trim();
    if (!baseName) {
      toast.error('请输入 Project 名称');
      return;
    }

    const joinPath = (root: string, child: string): string =>
      /[\\/]$/.test(root) ? `${root}${child}` : `${root}/${child}`;
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

  const handleClose = async () => {
    if (!menuState) return;
    const target = menuState.workspacePath;
    setMenuState(null);
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
    const targetAgentIds = new Set(
      agents
        .filter((agent) => normalizeComparePath(agent.workspace) === normalizeComparePath(target))
        .map((agent) => agent.id)
    );
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

  const openDevConsole = useCallback(async () => {
    try {
      const result = await hostApiFetch<{
        success: boolean;
        url?: string;
        error?: string;
      }>('/api/gateway/control-ui');
      if (result.success && result.url) {
        window.electron.openExternal(result.url);
      } else {
        toast.error(result.error || 'Failed to open debug console');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(message || 'Failed to open debug console');
    }
  }, []);

  return (
    <>
      <div className="flex w-16 h-full flex-col items-center gap-3 py-3 px-3 shrink-0">
        {projectItems.map((project) => (
          <WorkspaceShortcutButton
            key={project.path}
            workspace={project}
            onActivate={handleActivateProject}
            onContextMenu={handleContextMenu}
          />
        ))}
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0 text-muted-foreground hover:bg-black/5 dark:hover:bg-white/10"
          disabled={isAddingWorkspace}
          onClick={() => setShowAddProjectDialog(true)}
          title="Add Project"
          aria-label="Add Project"
        >
          +
        </Button>

        <Button
          variant="ghost"
          size="icon"
          className={cn(
            'mt-auto flex h-8 w-8 items-center justify-center rounded-lg border transition-colors',
            'border-transparent text-muted-foreground hover:bg-black/5 dark:hover:bg-white/10'
          )}
          onClick={() => setPreferencesOpen(true)}
          title="Preferences"
          aria-label="Open preferences"
        >
          <SlidersHorizontal className="h-4 w-4" strokeWidth={2} />
        </Button>

        {/* <Button
          variant="ghost"
          size="icon"
          className={cn(
            'flex h-8 w-8 items-center justify-center rounded-lg border transition-colors',
            'border-transparent text-muted-foreground hover:bg-black/5 dark:hover:bg-white/10'
          )}
          onClick={openSettingDialog}
          title="settings"
          aria-label="Open settings"
        >
          <SettingsIcon className="h-4 w-4" strokeWidth={2} />
        </Button> */}

        <Button
          variant="ghost"
          size="icon"
          className={cn(
            'flex h-8 w-8 items-center justify-center rounded-lg border transition-colors',
            'border-transparent text-muted-foreground hover:bg-black/5 dark:hover:bg-white/10'
          )}
          onClick={() => void openDevConsole()}
          title="Open debug console"
          aria-label="Open debug console"
        >
          <Terminal className="h-4 w-4" strokeWidth={2} />
        </Button>
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
            在文件资源管理器中打开
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

      <Dialog open={preferencesOpen} onOpenChange={setPreferencesOpen}>
        <DialogContent
          className="max-w-[900px] w-[90vw] h-[80vh] p-0 gap-0 overflow-hidden rounded-2xl bg-white dark:bg-[#1a1a1a] border border-black/10 dark:border-white/10"
          onPointerDownOutside={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
        >
          <VisuallyHidden>
            <DialogTitle>{t('common:sidebar.settings')}</DialogTitle>
          </VisuallyHidden>
          <Preferences />
        </DialogContent>
      </Dialog>
    </>
  );
}
