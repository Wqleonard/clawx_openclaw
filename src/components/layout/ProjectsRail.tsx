import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Settings as SettingsIcon } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../ui/button';
import { AddAgentDialog } from './AddAgentDialog';
import { invokeIpc } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { useAgentsStore } from '@/stores/agents';
import { useFileSystemStore } from '@/stores/filesystem';
import { useSettingDialogStore } from '@/stores/setting-dialog';
import { useSettingsStore } from '@/stores/settings';
import { useProjectsStore } from '@/stores/projects';

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

type WorkspaceBadgeTheme = {
  bg: string;
  text: string;
  border: string;
};

const WORKSPACE_THEMES: WorkspaceBadgeTheme[] = [
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

function getWorkspaceTheme(workspacePath: string): WorkspaceBadgeTheme {
  const initial = getWorkspaceInitial(workspacePath);
  const themeIndex = hashFromSeed(`${initial}:${workspacePath}`) % WORKSPACE_THEMES.length;
  return WORKSPACE_THEMES[themeIndex];
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
  const navigate = useNavigate();
  const openSettingDialog = useSettingDialogStore((state) => state.openDialog);
  const projectPath = useFileSystemStore((state) => state.workspacePath);
  const initWorkspace = useFileSystemStore((state) => state.initWorkspace);
  const clearWorkspace = useFileSystemStore((state) => state.clearWorkspace);
  const workspaceRoots = useSettingsStore((state) => {
    const workspaceState = state as { workspaceRoots?: string[] };
    return workspaceState.workspaceRoots ?? [];
  });
  const projectShortcuts = useProjectsStore((state) => state.workspaceShortcuts);
  const initProjectShortcuts = useProjectsStore((state) => state.initWorkspaceShortcuts);
  const addProjectShortcut = useProjectsStore((state) => state.addWorkspaceShortcut);
  const replaceProjectShortcut = useProjectsStore((state) => state.replaceWorkspaceShortcut);
  const removeProjectShortcut = useProjectsStore((state) => state.removeWorkspaceShortcut);
  const createAgent = useAgentsStore((state) => state.createAgent);
  const [menuState, setMenuState] = useState<ContextMenuState | null>(null);
  const [isAddingWorkspace, setIsAddingWorkspace] = useState(false);
  const [showAddAgentDialog, setShowAddAgentDialog] = useState(false);
  const [pendingWorkspacePath, setPendingWorkspacePath] = useState<string>('');

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

  const handleActivateProject = async (targetPath: string) => {
    if (!targetPath || targetPath === useFileSystemStore.getState().workspacePath) {
      navigate('/chat');
      return;
    }
    await initWorkspace(targetPath);
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

      await initWorkspace(selected);
      addProjectShortcut(selected); 
      setPendingWorkspacePath(selected);
      setShowAddAgentDialog(true);
    } finally {
      setIsAddingWorkspace(false);
    }
  };

  const handleEdit = async () => {
    if (!menuState) return;
    const targetPath = menuState.workspacePath;
    setMenuState(null);

    const allowedRoots = Array.from(new Set(workspaceRoots));
    if (allowedRoots.length === 0) {
      toast.error('请先在设置中配置可用工作区');
      return;
    }

    const result = await invokeIpc<{ canceled: boolean; filePaths?: string[] }>('dialog:open', {
      properties: ['openDirectory'],
      defaultPath: targetPath,
    });
    if (result.canceled || !result.filePaths?.length) return;

    const selected = result.filePaths[0];
    const isAllowed = allowedRoots.some((root) => isSameOrSubFolder(selected, root));
    if (!isAllowed) {
      toast.error('只能选择已设置工作区及其子文件夹');
      return;
    }

    replaceProjectShortcut(targetPath, selected);
    if (projectPath === targetPath) {
      await initWorkspace(selected);
    }
  };

  const handleClose = async () => {
    if (!menuState) return;
    const target = menuState.workspacePath;
    setMenuState(null);
    const nextShortcuts = projectShortcuts.filter((item) => item !== target);
    removeProjectShortcut(target);

    if (projectPath === target && nextShortcuts.length > 0) {
      await initWorkspace(nextShortcuts[0]);
      return;
    }

    if (projectPath === target && nextShortcuts.length === 0) {
      await clearWorkspace();
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
          <button
            type="button"
            onClick={() => void handleEdit()}
            className="w-full rounded px-2 py-1.5 text-left text-sm hover:bg-black/5 dark:hover:bg-white/10"
          >
            编辑
          </button>
          <button
            type="button"
            onClick={() => void handleClose()}
            className="w-full rounded px-2 py-1.5 text-left font-bold text-sm hover:bg-black/5 dark:hover:bg-white/10"
          >
            关闭
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
          toast.success('Agent 创建成功');
        }}
      />
    </>
  );
}
