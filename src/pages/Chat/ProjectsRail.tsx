import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '@/components/ui/confirm-dialog.tsx';
import { invokeIpc } from '@/lib/api-client.ts';
import { cn } from '@/lib/utils.ts';
import { useAgentsStore } from '@/stores/agents.ts';
import { useChatStore } from '@/stores/chat.ts';
import { useFileSystemStore } from '@/stores/filesystem.ts';
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
  // const openSettingDialog = useSettingDialogStore((state) => state.openDialog);
  const projectPath = useFileSystemStore((state) => state.projectPath);
  const clearProject = useFileSystemStore((state) => state.clearProject);
  const projectShortcuts = useFileSystemStore((state) => state.projectShortcuts);
  const initProjectShortcuts = useFileSystemStore((state) => state.initProjectShortcuts);
  const addProjectShortcut = useFileSystemStore((state) => state.addProjectShortcut);
  const removeProjectShortcut = useFileSystemStore((state) => state.removeProjectShortcut);
  const deleteAgent = useAgentsStore((state) => state.deleteAgent);
  const [menuState, setMenuState] = useState<ContextMenuState | null>(null);
  const [projectToClose, setProjectToClose] = useState<string | null>(null);
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);

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
    void recoverProjectShortcutsFromDisk();
  }, [recoverProjectShortcutsFromDisk]);

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

  const requestProjectSwitch = useCallback((targetPath: string) => {
    if (!targetPath) return;
    window.dispatchEvent(
      new CustomEvent('project:switch-request', {
        detail: { path: targetPath },
      }),
    );
  }, []);

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
      requestProjectSwitch(nextProject);
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
                      requestProjectSwitch(project.path);
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
                  onClick={() => {
                    window.dispatchEvent(new CustomEvent('project:create-request'));
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
    </>
  );
}
