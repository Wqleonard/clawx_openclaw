/**
 * Main Layout Component
 * TitleBar at top, then sidebar + content below.
 */
import { useEffect, useMemo, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { toast } from 'sonner';
import { Sidebar } from './Sidebar';
import { TitleBar } from './TitleBar';
import { WorkspaceRail, type WorkspaceItem } from './WorkspaceRail';
import { invokeIpc } from '@/lib/api-client';
import { useFileSystemStore } from '@/stores/filesystem';
import { useSettingsStore } from '@/stores/settings';

const WORKSPACE_STORAGE_KEY = 'clawx:workspace-shortcuts';

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

export function MainLayout() {
  const workspacePath = useFileSystemStore((state) => state.workspacePath);
  const initWorkspace = useFileSystemStore((state) => state.initWorkspace);
  const workspaceRoots = useSettingsStore((state) => state.workspaceRoots);
  const [workspaceShortcuts, setWorkspaceShortcuts] = useState<string[]>([]);
  const [isAddingWorkspace, setIsAddingWorkspace] = useState(false);

  useEffect(() => {
    const raw = window.localStorage.getItem(WORKSPACE_STORAGE_KEY);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return;
      const shortcuts = parsed.filter((item): item is string => typeof item === 'string');
      setWorkspaceShortcuts(shortcuts);
    } catch {
      // Ignore invalid localStorage payload
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(workspaceShortcuts));
  }, [workspaceShortcuts]);

  useEffect(() => {
    if (!workspacePath) return;
    setWorkspaceShortcuts((prev) =>
      prev.includes(workspacePath) ? prev : [workspacePath, ...prev]
    );
  }, [workspacePath]);

  const workspaceItems = useMemo<WorkspaceItem[]>(
    () =>
      workspaceShortcuts.map((path) => ({
        path,
        initial: getWorkspaceInitial(path),
        name: getWorkspaceName(path),
        theme: getWorkspaceTheme(path),
        isActive: path === workspacePath,
      })),
    [workspacePath, workspaceShortcuts]
  );

  const handleAddWorkspace = async () => {
    const allowedRoots = Array.from(new Set(workspaceRoots));
    if (allowedRoots.length === 0) {
      toast.error('请先在设置中配置可用工作区');
      return;
    }

    setIsAddingWorkspace(true);
    try {
      const result = await invokeIpc<{ canceled: boolean; filePaths?: string[] }>('dialog:open', {
        properties: ['openDirectory'],
        defaultPath: workspacePath || workspaceRoots[0] || workspaceShortcuts[0],
      });
      if (result.canceled || !result.filePaths?.length) return;

      const selected = result.filePaths[0];
      const isAllowed = allowedRoots.some((root) => isSameOrSubFolder(selected, root));
      if (!isAllowed) {
        toast.error('只能选择已设置工作区及其子文件夹');
        return;
      }

      await initWorkspace(selected);
      setWorkspaceShortcuts((prev) => (prev.includes(selected) ? prev : [selected, ...prev]));
    } finally {
      setIsAddingWorkspace(false);
    }
  };

  const handleSwitchWorkspace = async (targetPath: string) => {
    if (!targetPath || targetPath === workspacePath) return;
    await initWorkspace(targetPath);
  };

  const handleEditWorkspace = async (targetPath: string) => {
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

    setWorkspaceShortcuts((prev) => {
      const replaced = prev.map((item) => (item === targetPath ? selected : item));
      return Array.from(new Set(replaced));
    });

    if (workspacePath === targetPath) {
      await initWorkspace(selected);
    }
  };

  const handleCloseWorkspace = async (targetPath: string) => {
    const nextShortcuts = workspaceShortcuts.filter((item) => item !== targetPath);
    setWorkspaceShortcuts(nextShortcuts);

    if (workspacePath === targetPath && nextShortcuts.length > 0) {
      await initWorkspace(nextShortcuts[0]);
    }
  };

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      {/* Title bar: drag region on macOS, icon + controls on Windows */}
      <TitleBar />

      {/* Below the title bar: sidebar + content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Workspace Rail */}
        <WorkspaceRail
          workspaceItems={workspaceItems}
          isAddingWorkspace={isAddingWorkspace}
          onAddWorkspace={handleAddWorkspace}
          onSwitchWorkspace={handleSwitchWorkspace}
          onEditWorkspace={handleEditWorkspace}
          onCloseWorkspace={handleCloseWorkspace}
        />

        <Sidebar />
        <main className="flex-1 overflow-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
