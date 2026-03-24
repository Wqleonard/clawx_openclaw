import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { invokeIpc } from '@/lib/api-client';
import type { FileNode } from '@/types/electron';

type FileSystemState = {
  projectPath: string | null;
  defaultProjectPath: string | null;
  projectBindings: Record<string, string>;
  projectShortcuts: string[];
  tree: FileNode | null;
  openFiles: string[];
  activeFile: string | null;
  fileContents: Record<string, string>;
  dirtyFiles: string[];
  contextFiles: string[];
  isWatching: boolean;
  lastError: string | null;

  openFolder: () => Promise<string | null>;
  initProjectShortcuts: () => void;
  addProjectShortcut: (path: string) => void;
  replaceProjectShortcut: (fromPath: string, toPath: string) => void;
  removeProjectShortcut: (path: string) => void;
  bindProjectToSession: (sessionKey: string, projectPath: string) => Promise<void>;
  applyProjectForSession: (sessionKey: string) => Promise<void>;
  initProject: (projectPath: string) => Promise<void>;
  clearProject: () => Promise<void>;
  refreshTree: (dirPath?: string) => Promise<void>;
  openFile: (filePath: string) => Promise<void>;
  closeFile: (filePath: string) => void;
  setActiveFile: (filePath: string | null) => void;
  updateFileContent: (filePath: string, content: string) => void;
  saveFile: (filePath: string) => Promise<void>;
  createFile: (filePath: string) => Promise<void>;
  createFolder: (dirPath: string) => Promise<void>;
  renameNode: (oldPath: string, newPath: string) => Promise<void>;
  moveNode: (sourcePath: string, targetPath: string) => Promise<void>;
  copyNode: (sourcePath: string, targetPath: string) => Promise<void>;
  deleteNode: (targetPath: string) => Promise<void>;
  addToContext: (filePath: string, agentId?: string) => Promise<void>;
  removeFromContext: (filePath: string, agentId?: string) => Promise<void>;
  loadContextFiles: (agentId?: string) => Promise<void>;
  startWatching: () => Promise<void>;
  stopWatching: () => Promise<void>;
  clearError: () => void;
};

type PersistedProjectState = Pick<
  FileSystemState,
  'projectPath' | 'defaultProjectPath' | 'projectBindings' | 'projectShortcuts'
>;

let removeFsChangedListener: (() => void) | null = null;
const HIDDEN_RUNTIME_FILES = new Set([
  'AGENTS.md',
  'SOUL.md',
  'TOOLS.md',
  'USER.md',
  'IDENTITY.md',
  'HEARTBEAT.md',
  'BOOT.md',
  'BOOTSTRAP.md',
  'BOOTSRAP.md',
  'README.md',
]);
const LEGACY_WORKSPACE_SHORTCUTS_KEY = 'clawx:workspace-shortcuts';

function normalizeFsPath(path: string): string {
  return path.replace(/[\\/]+/g, '/').replace(/\/+$/, '').toLowerCase();
}

function isPathInsideProject(targetPath: string, projectPath: string): boolean {
  const normalizedTarget = normalizeFsPath(targetPath);
  const normalizedProject = normalizeFsPath(projectPath);
  return (
    normalizedTarget === normalizedProject ||
    normalizedTarget.startsWith(`${normalizedProject}/`)
  );
}

function readLegacyProjectShortcuts(): string[] {
  if (typeof window === 'undefined') return [];
  const raw = window.localStorage.getItem(LEGACY_WORKSPACE_SHORTCUTS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === 'string');
  } catch {
    return [];
  }
}

function sanitizeTreeForUi(
  tree: FileNode,
  projectPath: string | null,
): FileNode {
  if (!projectPath || tree.type !== 'folder') {
    return tree;
  }

  if (normalizeFsPath(tree.path) !== normalizeFsPath(projectPath)) {
    return tree;
  }

  const children = (tree.children || []).filter((child) => (
    !(child.type === 'file' && HIDDEN_RUNTIME_FILES.has(child.name))
  ));

  return {
    ...tree,
    children,
  };
}

function isWorkspaceNotSelectedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('Workspace is not selected');
}

function selectPersistedProjectState(state: FileSystemState): PersistedProjectState {
  return {
    projectPath: state.projectPath,
    defaultProjectPath: state.defaultProjectPath,
    projectBindings: state.projectBindings,
    projectShortcuts: state.projectShortcuts,
  };
}

async function persistProjectStateBackup(state: FileSystemState): Promise<void> {
  try {
    await invokeIpc('fs:project-state:set', selectPersistedProjectState(state));
  } catch (error) {
    // Keep local persist as primary, but expose backup write failures for diagnostics.
    console.warn('[filesystem-store] failed to persist project backup:', error);
  }
}

async function ensureMainProjectSynced(
  get: () => FileSystemState,
): Promise<string | null> {
  const localProject = get().projectPath;
  if (!localProject) return null;
  const mainWorkspace = await invokeIpc<string | null>('fs:get-workspace');
  // If project switched while awaiting IPC, treat this call as stale.
  if (get().projectPath !== localProject) return null;
  if (mainWorkspace === localProject) return localProject;
  await invokeIpc<string>('fs:set-workspace', localProject);
  // Double-check after write to avoid stale callers overriding newer project.
  if (get().projectPath !== localProject) return null;
  return localProject;
}

function setStoreError(
  set: (partial: Partial<FileSystemState> | ((state: FileSystemState) => Partial<FileSystemState>)) => void,
  error: unknown,
): void {
  const message = error instanceof Error ? error.message : String(error);
  set({ lastError: message });
}

export const useFileSystemStore = create<FileSystemState>()(
  persist(
    (set, get) => ({
      projectPath: null,
      defaultProjectPath: null,
      projectBindings: {},
      projectShortcuts: [],
      tree: null,
      openFiles: [],
      activeFile: null,
      fileContents: {},
      dirtyFiles: [],
      contextFiles: [],
      isWatching: false,
      lastError: null,

      openFolder: async () => {
        try {
          const selected = await invokeIpc<string | null>('fs:open-folder');
          if (!selected) return null;
          await get().initProject(selected);
          return selected;
        } catch (error) {
          setStoreError(set, error);
          return null;
        }
      },

      initProjectShortcuts: () => {
        const legacyShortcuts = readLegacyProjectShortcuts();
        if (legacyShortcuts.length === 0) return;
        set((state) => ({
          projectShortcuts: Array.from(new Set([...state.projectShortcuts, ...legacyShortcuts])),
        }));
        window.localStorage.removeItem(LEGACY_WORKSPACE_SHORTCUTS_KEY);
        void persistProjectStateBackup(get());
      },

      addProjectShortcut: (path) => {
        if (!path) return;
        set((state) => ({
          projectShortcuts: state.projectShortcuts.includes(path)
            ? state.projectShortcuts
            : [path, ...state.projectShortcuts],
        }));
        void persistProjectStateBackup(get());
      },

      replaceProjectShortcut: (fromPath, toPath) => {
        if (!fromPath || !toPath) return;
        set((state) => ({
          projectShortcuts: Array.from(
            new Set(state.projectShortcuts.map((item) => (item === fromPath ? toPath : item))),
          ),
          projectBindings: Object.fromEntries(
            Object.entries(state.projectBindings).map(([sessionKey, boundPath]) => [
              sessionKey,
              boundPath === fromPath ? toPath : boundPath,
            ]),
          ),
          defaultProjectPath: state.defaultProjectPath === fromPath ? toPath : state.defaultProjectPath,
        }));
        void persistProjectStateBackup(get());
      },

      removeProjectShortcut: (path) => {
        if (!path) return;
        set((state) => {
          const nextShortcuts = state.projectShortcuts.filter((item) => item !== path);
          const nextBindings = Object.fromEntries(
            Object.entries(state.projectBindings).filter(([, boundPath]) => boundPath !== path),
          );
          const nextDefaultProjectPath = state.defaultProjectPath === path
            ? (nextShortcuts[0] ?? null)
            : state.defaultProjectPath;
          return {
            projectShortcuts: nextShortcuts,
            projectBindings: nextBindings,
            defaultProjectPath: nextDefaultProjectPath,
          };
        });
        void persistProjectStateBackup(get());
      },

      bindProjectToSession: async (sessionKey, projectPath) => {
        if (!sessionKey || !projectPath) return;
        set((state) => ({
          projectBindings: {
            ...state.projectBindings,
            [sessionKey]: projectPath,
          },
          defaultProjectPath: projectPath,
        }));
        void persistProjectStateBackup(get());
      },

      applyProjectForSession: async (sessionKey) => {
        if (!sessionKey) return;
        const state = get();
        const boundPath = state.projectBindings[sessionKey] || state.defaultProjectPath;
        if (boundPath) {
          try {
            await get().initProject(boundPath);
          } catch {
            // ignore error
          }
        }
      },

      initProject: async (projectPath) => {
        await invokeIpc<string>('fs:set-workspace', projectPath);
        set({
          projectPath,
          tree: null,
          openFiles: [],
          activeFile: null,
          fileContents: {},
          dirtyFiles: [],
          contextFiles: [],
          lastError: null,
        });
        void persistProjectStateBackup(get());
        await get().refreshTree();
      },

      clearProject: async () => {
        try {
          await invokeIpc<boolean>('fs:watch-stop');
        } catch {
          // Ignore watcher stop failures during workspace clear.
        }

        if (removeFsChangedListener) {
          removeFsChangedListener();
          removeFsChangedListener = null;
        }

        set({
          projectPath: null,
          tree: null,
          openFiles: [],
          activeFile: null,
          fileContents: {},
          dirtyFiles: [],
          contextFiles: [],
          isWatching: false,
          lastError: null,
        });
        void persistProjectStateBackup(get());
      },

      refreshTree: async (dirPath) => {
        try {
          const requestedProject = get().projectPath;
          if (!requestedProject) {
            set({ tree: null, lastError: null });
            return;
          }
          const projectPath = await ensureMainProjectSynced(get);
          if (!projectPath) {
            return;
          }
          const targetDirPath =
            dirPath && isPathInsideProject(dirPath, projectPath)
              ? dirPath
              : projectPath;
          const tree = await invokeIpc<FileNode>('fs:read-tree', targetDirPath);
          // Project may switch while refreshing; ignore stale result.
          if (get().projectPath !== projectPath) {
            return;
          }
          const sanitizedTree = sanitizeTreeForUi(tree, projectPath);
          set({ tree: sanitizedTree, lastError: null });
        } catch (error) {
          setStoreError(set, error);
        }
      },

      openFile: async (filePath) => {
        try {
          const state = get();
          const hasDirtyBuffer = state.dirtyFiles.includes(filePath) && typeof state.fileContents[filePath] === 'string';
          const content = hasDirtyBuffer
            ? state.fileContents[filePath]
            : await invokeIpc<string>('fs:read-file', filePath);
          set((state) => ({
            openFiles: state.openFiles.includes(filePath) ? state.openFiles : [...state.openFiles, filePath],
            activeFile: filePath,
            fileContents: { ...state.fileContents, [filePath]: content },
            lastError: null,
          }));
        } catch (error) {
          setStoreError(set, error);
        }
      },

      closeFile: (filePath) => {
        set((state) => {
          const nextOpenFiles = state.openFiles.filter((item) => item !== filePath);
          const nextActiveFile = state.activeFile === filePath ? (nextOpenFiles[nextOpenFiles.length - 1] ?? null) : state.activeFile;
          const nextContents = { ...state.fileContents };
          delete nextContents[filePath];
          return {
            openFiles: nextOpenFiles,
            activeFile: nextActiveFile,
            fileContents: nextContents,
            dirtyFiles: state.dirtyFiles.filter((item) => item !== filePath),
            contextFiles: state.contextFiles.filter((item) => item !== filePath),
          };
        });
      },

      setActiveFile: (filePath) => {
        set({ activeFile: filePath });
      },

      updateFileContent: (filePath, content) => {
        set((state) => {
          const dirty = state.dirtyFiles.includes(filePath) ? state.dirtyFiles : [...state.dirtyFiles, filePath];
          return {
            fileContents: { ...state.fileContents, [filePath]: content },
            dirtyFiles: dirty,
          };
        });
      },

      saveFile: async (filePath) => {
        const content = get().fileContents[filePath];
        if (typeof content !== 'string') return;
        try {
          await invokeIpc<boolean>('fs:write-file', filePath, content);
          set((state) => ({
            dirtyFiles: state.dirtyFiles.filter((item) => item !== filePath),
            lastError: null,
          }));
        } catch (error) {
          setStoreError(set, error);
        }
      },

      createFile: async (filePath) => {
        try {
          await invokeIpc<boolean>('fs:create-file', filePath);
          await get().refreshTree();
          await get().openFile(filePath);
        } catch (error) {
          setStoreError(set, error);
        }
      },

      createFolder: async (dirPath) => {
        try {
          await invokeIpc<boolean>('fs:create-folder', dirPath);
          await get().refreshTree();
        } catch (error) {
          setStoreError(set, error);
        }
      },

      renameNode: async (oldPath, newPath) => {
        try {
          await invokeIpc<boolean>('fs:rename', oldPath, newPath);
          set((state) => {
            const isOpen = state.openFiles.includes(oldPath);
            if (!isOpen) return {};
            const nextOpen = state.openFiles.map((item) => (item === oldPath ? newPath : item));
            const nextContents = { ...state.fileContents };
            if (nextContents[oldPath] !== undefined) {
              nextContents[newPath] = nextContents[oldPath];
              delete nextContents[oldPath];
            }
            const nextDirty = state.dirtyFiles.map((item) => (item === oldPath ? newPath : item));
            const nextContext = state.contextFiles.map((item) => (item === oldPath ? newPath : item));
            return {
              openFiles: nextOpen,
              activeFile: state.activeFile === oldPath ? newPath : state.activeFile,
              fileContents: nextContents,
              dirtyFiles: nextDirty,
              contextFiles: nextContext,
            };
          });
          await get().refreshTree();
        } catch (error) {
          setStoreError(set, error);
        }
      },

      moveNode: async (sourcePath, targetPath) => {
        try {
          await invokeIpc<boolean>('fs:move', sourcePath, targetPath);
          set((state) => {
            const remap = (value: string) => (
              value === sourcePath || value.startsWith(`${sourcePath}/`)
                ? value.replace(sourcePath, targetPath)
                : value
            );
            const nextOpen = state.openFiles.map(remap);
            const nextDirty = state.dirtyFiles.map(remap);
            const nextContext = state.contextFiles.map(remap);
            const nextContents = Object.fromEntries(
              Object.entries(state.fileContents).map(([key, val]) => [remap(key), val]),
            );
            return {
              openFiles: nextOpen,
              activeFile: state.activeFile ? remap(state.activeFile) : null,
              dirtyFiles: nextDirty,
              contextFiles: nextContext,
              fileContents: nextContents,
            };
          });
          await get().refreshTree();
        } catch (error) {
          setStoreError(set, error);
        }
      },

      copyNode: async (sourcePath, targetPath) => {
        try {
          await invokeIpc<boolean>('fs:copy', sourcePath, targetPath);
          await get().refreshTree();
        } catch (error) {
          setStoreError(set, error);
        }
      },

      deleteNode: async (targetPath) => {
        try {
          await invokeIpc<boolean>('fs:delete', targetPath);
          set((state) => {
            const shouldRemove = (value: string) => value === targetPath || value.startsWith(`${targetPath}/`);
            const nextOpen = state.openFiles.filter((item) => !shouldRemove(item));
            const nextContents = { ...state.fileContents };
            Object.keys(nextContents).forEach((key) => {
              if (shouldRemove(key)) delete nextContents[key];
            });
            return {
              openFiles: nextOpen,
              activeFile: state.activeFile && shouldRemove(state.activeFile) ? null : state.activeFile,
              fileContents: nextContents,
              dirtyFiles: state.dirtyFiles.filter((item) => !shouldRemove(item)),
              contextFiles: state.contextFiles.filter((item) => !shouldRemove(item)),
            };
          });
          await get().refreshTree();
        } catch (error) {
          setStoreError(set, error);
        }
      },

      addToContext: async (filePath, agentId) => {
        try {
          await invokeIpc<boolean>('fs:add-to-context', filePath, agentId);
          set((state) => ({
            contextFiles: state.contextFiles.includes(filePath)
              ? state.contextFiles
              : [...state.contextFiles, filePath],
            lastError: null,
          }));
        } catch (error) {
          setStoreError(set, error);
        }
      },

      removeFromContext: async (filePath, agentId) => {
        try {
          await invokeIpc<boolean>('fs:remove-from-context', filePath, agentId);
          set((state) => ({
            contextFiles: state.contextFiles.filter((item) => item !== filePath),
            lastError: null,
          }));
        } catch (error) {
          setStoreError(set, error);
        }
      },

      loadContextFiles: async (agentId) => {
        try {
          const project = await ensureMainProjectSynced(get);
          if (!project) {
            set({ contextFiles: [], lastError: null });
            return;
          }
          const files = await invokeIpc<string[]>('fs:list-context', agentId);
          set({ contextFiles: files, lastError: null });
        } catch (error) {
          setStoreError(set, error);
        }
      },

      startWatching: async () => {
        try {
          if (removeFsChangedListener) {
            removeFsChangedListener();
            removeFsChangedListener = null;
          }
          const project = await ensureMainProjectSynced(get);
          if (!project) {
            set({ isWatching: false, lastError: null });
            return;
          }
          await invokeIpc<boolean>('fs:watch-start');
          removeFsChangedListener = window.electron.fs.onChanged(() => {
            void get().refreshTree();
          });
          set({ isWatching: true, lastError: null });
        } catch (error) {
          // App restart can keep persisted projectPath in renderer while main process has no selected workspace yet.
          // Try one more sync silently before reporting an error.
          if (isWorkspaceNotSelectedError(error)) {
            const project = get().projectPath;
            if (project) {
              try {
                await invokeIpc<string>('fs:set-workspace', project);
                await invokeIpc<boolean>('fs:watch-start');
                removeFsChangedListener = window.electron.fs.onChanged(() => {
                  void get().refreshTree();
                });
                set({ isWatching: true, lastError: null });
                return;
              } catch {
                // fall through to degrade branch below
              }
            }
            // No workspace available locally: degrade quietly.
            set({
              projectPath: null,
              tree: null,
              openFiles: [],
              activeFile: null,
              fileContents: {},
              dirtyFiles: [],
              contextFiles: [],
              isWatching: false,
              lastError: null,
            });
            return;
          }
          setStoreError(set, error);
        }
      },

      stopWatching: async () => {
        try {
          await invokeIpc<boolean>('fs:watch-stop');
          if (removeFsChangedListener) {
            removeFsChangedListener();
            removeFsChangedListener = null;
          }
          set({ isWatching: false, lastError: null });
        } catch (error) {
          setStoreError(set, error);
        }
      },

      clearError: () => {
        set({ lastError: null });
      },
    }),
    {
      name: 'filesystem-store',
      version: 2,
      migrate: (persistedState) => {
        const state = (persistedState ?? {}) as Partial<{
          workspacePath: string | null;
          defaultWorkspacePath: string | null;
          workspaceBindings: Record<string, string>;
          projectPath: string | null;
          defaultProjectPath: string | null;
          projectBindings: Record<string, string>;
          projectShortcuts: string[];
        }>;
        const legacyShortcuts = readLegacyProjectShortcuts();
        const mergedShortcuts = Array.from(
          new Set([...(state.projectShortcuts ?? []), ...legacyShortcuts]),
        );
        if (legacyShortcuts.length > 0 && typeof window !== 'undefined') {
          window.localStorage.removeItem(LEGACY_WORKSPACE_SHORTCUTS_KEY);
        }
        return {
          ...state,
          projectPath: state.projectPath ?? state.workspacePath ?? null,
          defaultProjectPath: state.defaultProjectPath ?? state.defaultWorkspacePath ?? null,
          projectBindings: state.projectBindings ?? state.workspaceBindings ?? {},
          projectShortcuts: mergedShortcuts,
        } satisfies Partial<FileSystemState>;
      },
      partialize: (state) => ({
        projectPath: state.projectPath,
        defaultProjectPath: state.defaultProjectPath,
        projectBindings: state.projectBindings,
        projectShortcuts: state.projectShortcuts,
      }),
    },
  ),
);

const restoreProjectStateFromBackup = async (): Promise<void> => {
  try {
    const backup = await invokeIpc<PersistedProjectState | null>('fs:project-state:get');
    if (!backup) return;

    const current = useFileSystemStore.getState();
    const mergedShortcuts = Array.from(
      new Set([...(current.projectShortcuts ?? []), ...(backup.projectShortcuts ?? [])]),
    );
    const mergedBindings = {
      ...(backup.projectBindings ?? {}),
      ...(current.projectBindings ?? {}),
    };
    const nextProjectPath = current.projectPath ?? backup.projectPath ?? null;
    const nextDefaultProjectPath =
      current.defaultProjectPath ?? backup.defaultProjectPath ?? null;

    const changed =
      nextProjectPath !== current.projectPath ||
      nextDefaultProjectPath !== current.defaultProjectPath ||
      mergedShortcuts.length !== current.projectShortcuts.length ||
      Object.keys(mergedBindings).length !== Object.keys(current.projectBindings).length;

    if (!changed) return;

    useFileSystemStore.setState((state) => ({
      ...state,
      projectPath: nextProjectPath,
      defaultProjectPath: nextDefaultProjectPath,
      projectBindings: mergedBindings,
      projectShortcuts: mergedShortcuts,
    }));

    void persistProjectStateBackup(useFileSystemStore.getState());
  } catch {
    // Ignore backup restore failures and rely on existing persist.
  }
};

const storeWithPersist = useFileSystemStore as typeof useFileSystemStore & {
  persist?: {
    hasHydrated?: () => boolean;
    onFinishHydration?: (callback: () => void) => () => void;
  };
};

if (storeWithPersist.persist?.hasHydrated?.()) {
  void restoreProjectStateFromBackup();
  void persistProjectStateBackup(useFileSystemStore.getState());
} else if (storeWithPersist.persist?.onFinishHydration) {
  storeWithPersist.persist.onFinishHydration(() => {
    void restoreProjectStateFromBackup();
    void persistProjectStateBackup(useFileSystemStore.getState());
  });
} else {
  // Fallback path for unexpected persist API shapes.
  void restoreProjectStateFromBackup();
  void persistProjectStateBackup(useFileSystemStore.getState());
}
