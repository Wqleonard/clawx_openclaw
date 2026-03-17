import { create } from 'zustand';

const WORKSPACE_STORAGE_KEY = 'clawx:workspace-shortcuts';

type ProjectsStoreState = {
  workspaceShortcuts: string[];
  initWorkspaceShortcuts: () => void;
  addWorkspaceShortcut: (path: string) => void;
  replaceWorkspaceShortcut: (fromPath: string, toPath: string) => void;
  removeWorkspaceShortcut: (path: string) => void;
};

function readWorkspaceShortcutsFromStorage(): string[] {
  const raw = window.localStorage.getItem(WORKSPACE_STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === 'string');
  } catch {
    return [];
  }
}

function writeWorkspaceShortcutsToStorage(shortcuts: string[]): void {
  window.localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(shortcuts));
}

export const useProjectsStore = create<ProjectsStoreState>((set, get) => ({
  workspaceShortcuts: [],

  initWorkspaceShortcuts: () => {
    const current = get().workspaceShortcuts;
    if (current.length > 0) return;
    const shortcuts = readWorkspaceShortcutsFromStorage();
    set({ workspaceShortcuts: shortcuts });
  },

  addWorkspaceShortcut: (path) => {
    if (!path) return;
    const current = get().workspaceShortcuts;
    const next = current.includes(path) ? current : [path, ...current];
    if (next === current) return;
    writeWorkspaceShortcutsToStorage(next);
    set({ workspaceShortcuts: next });
  },

  replaceWorkspaceShortcut: (fromPath, toPath) => {
    if (!fromPath || !toPath) return;
    const current = get().workspaceShortcuts;
    const replaced = current.map((item) => (item === fromPath ? toPath : item));
    const next = Array.from(new Set(replaced));
    writeWorkspaceShortcutsToStorage(next);
    set({ workspaceShortcuts: next });
  },

  removeWorkspaceShortcut: (path) => {
    if (!path) return;
    const current = get().workspaceShortcuts;
    const next = current.filter((item) => item !== path);
    writeWorkspaceShortcutsToStorage(next);
    set({ workspaceShortcuts: next });
  },
}));
