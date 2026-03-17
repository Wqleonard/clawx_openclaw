import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Settings as SettingsIcon, SlidersHorizontal } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Button } from '../ui/button';
import { AddAgentDialog } from './AddAgentDialog';
import { invokeIpc } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { useAgentsStore } from '@/stores/agents';
import { useChatStore } from '@/stores/chat';
import { useFileSystemStore } from '@/stores/filesystem';
import { useSettingDialogStore } from '@/stores/setting-dialog';
import { useSettingsStore } from '@/stores/settings';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Preferences } from '@/pages/Preferences';

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
  return inputPath.replace(/[\\/]+/g, '/').replace(/\/+$/, '').toLowerCase();
}

function isSameOrSubFolder(selectedPath: string, rootPath: string): boolean {
  const selected = normalizeComparePath(selectedPath);
  const root = normalizeComparePath(rootPath);
  return selected === root || selected.startsWith(`${root}/`);
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
  const workspaceRoots = useSettingsStore((state) => {
    const workspaceState = state as { workspaceRoots?: string[] };
    return workspaceState.workspaceRoots ?? [];
  });
  const createAgent = useAgentsStore((state) => state.createAgent);
  const [menuState, setMenuState] = useState<ContextMenuState | null>(null);
  const [isAddingWorkspace, setIsAddingWorkspace] = useState(false);
  const [showAddAgentDialog, setShowAddAgentDialog] = useState(false);
  const [pendingWorkspacePath, setPendingWorkspacePath] = useState<string>('');
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

  const handleContextMenu = (event: React.MouseEvent, targetPath: string) => {
    event.preventDefault();
    event.stopPropagation();
    setMenuState({
      workspacePath: targetPath,
      x: event.clientX,
      y: event.clientY,
    });
  };

  const switchToProjectSession = useCallback(async (targetPath: string) => {
    const chatState = useChatStore.getState();
    const fsState = useFileSystemStore.getState();
    const targetSessions = [...chatState.sessions]
      .filter((session) => fsState.projectBindings[session.key] === targetPath)
      .sort((a, b) => (chatState.sessionLastActivity[b.key] ?? 0) - (chatState.sessionLastActivity[a.key] ?? 0));

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
  }, []);

  const handleActivateProject = async (targetPath: string) => {
    if (!targetPath || targetPath === useFileSystemStore.getState().projectPath) {
      navigate('/chat');
      return;
    }
    await initProject(targetPath);
    await switchToProjectSession(targetPath);
    navigate('/chat');
  };

  const handleAddProject = async () => {
    const allowedRoots = Array.from(new Set(workspaceRoots));
    if (allowedRoots.length === 0) {
      toast.error('请先在设置中配置可用工作区');
      return;
    }

    setIsAddingWorkspace(true);
    try {
      const result = await invokeIpc<{ canceled: boolean; filePaths?: string[] }>('dialog:open', {
        properties: ['openDirectory'],
        defaultPath: workspaceRoots[0] || projectPath || projectShortcuts[0],
      });
      if (result.canceled || !result.filePaths?.length) return;

      const selected = result.filePaths[0];
      const isAllowed = allowedRoots.some((root) => isSameOrSubFolder(selected, root));
      if (!isAllowed) {
        toast.error('只能选择已设置工作区及其子文件夹');
        return;
      }

      await initProject(selected);
      addProjectShortcut(selected);
      await switchToProjectSession(selected);
      setPendingWorkspacePath(selected);
      setShowAddAgentDialog(true);
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
    const sessionsToDelete = useChatStore
      .getState()
      .sessions.filter((session) => useFileSystemStore.getState().projectBindings[session.key] === target)
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
      await initProject(nextProject);
      await switchToProjectSession(nextProject);
      return;
    }

    if (projectPath === target && nextShortcuts.length === 0) {
      await clearProject();
    }
  };

  return (
    <>
      <div className="flex w-16 h-full flex-col items-center gap-3 py-3">
        {projectItems.map((workspace) => (
          <WorkspaceShortcutButton
            key={workspace.path}
            workspace={workspace}
            onActivate={handleActivateProject}
            onContextMenu={handleContextMenu}
          />
        ))}
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0 text-muted-foreground hover:bg-black/5 dark:hover:bg-white/10"
          disabled={isAddingWorkspace}
          onClick={() => void handleAddProject()}
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

        <Button
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
          setPendingWorkspacePath('');
        }}
        initialWorkspacePath={pendingWorkspacePath}
        hideWorkspaceSelector
        onCreate={async (name, options) => {
          const workspacePath = options.workspacePath || pendingWorkspacePath;
          await createAgent(name, { ...options, workspacePath });
          setShowAddAgentDialog(false);
          setPendingWorkspacePath('');
          toast.success(t('common:status.agentCreated'));
        }}
      />

      <Dialog open={preferencesOpen} onOpenChange={setPreferencesOpen}>
        <DialogContent
          className="max-w-[900px] w-[90vw] h-[80vh] p-0 gap-0 overflow-hidden rounded-2xl bg-white dark:bg-[#1a1a1a] border border-black/10 dark:border-white/10"
          onPointerDownOutside={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
        >
          <Preferences />
        </DialogContent>
      </Dialog>
    </>
  );
}
