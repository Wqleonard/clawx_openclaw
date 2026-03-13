import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { invokeIpc } from '@/lib/api-client';
import { hostApiFetch } from '@/lib/host-api';
import type { FileNode } from '@/types/electron';

type FileSystemState = {
  workspacePath: string | null;
  defaultWorkspacePath: string | null;
  workspaceBindings: Record<string, string>;
  tree: FileNode | null;
  openFiles: string[];
  activeFile: string | null;
  fileContents: Record<string, string>;
  dirtyFiles: string[];
  contextFiles: string[];
  isWatching: boolean;
  lastError: string | null;

  openFolder: () => Promise<string | null>;
  bindWorkspaceToSession: (sessionKey: string, workspacePath: string) => Promise<void>;
  applyWorkspaceForSession: (sessionKey: string) => Promise<void>;
  ensureDefaultWorkspaceForSession: (sessionKey: string) => Promise<void>;
  initWorkspace: (workspacePath: string) => Promise<void>;
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

let removeFsChangedListener: (() => void) | null = null;
const DEFAULT_AGENT_ID = 'main';
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
  'READMR.md',
]);

function resolveAgentIdFromSessionKey(sessionKey: string): string {
  if (!sessionKey.startsWith('agent:')) {
    return DEFAULT_AGENT_ID;
  }
  const [, agentId] = sessionKey.split(':');
  return (agentId || DEFAULT_AGENT_ID).trim() || DEFAULT_AGENT_ID;
}

async function syncAgentWorkspaceBinding(sessionKey: string, workspacePath: string): Promise<void> {
  const agentId = resolveAgentIdFromSessionKey(sessionKey);
  await hostApiFetch<{ success: boolean; changed?: boolean }>(
    `/api/agents/${encodeURIComponent(agentId)}`,
    {
      method: 'PUT',
      body: JSON.stringify({ workspace: workspacePath }),
    },
  );
}

function sanitizeTreeForUi(
  tree: FileNode,
  workspacePath: string | null,
): FileNode {
  if (!workspacePath || tree.type !== 'folder' || tree.path !== workspacePath) {
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

async function ensureMainWorkspaceSynced(
  get: () => FileSystemState,
): Promise<string | null> {
  const localWorkspace = get().workspacePath;
  if (!localWorkspace) return null;
  const mainWorkspace = await invokeIpc<string | null>('fs:get-workspace');
  if (mainWorkspace === localWorkspace) return localWorkspace;
  await invokeIpc<string>('fs:set-workspace', localWorkspace);
  return localWorkspace;
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
      workspacePath: null,
      defaultWorkspacePath: null,
      workspaceBindings: {},
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
          await get().initWorkspace(selected);
          return selected;
        } catch (error) {
          setStoreError(set, error);
          return null;
        }
      },

      bindWorkspaceToSession: async (sessionKey, workspacePath) => {
        if (!sessionKey || !workspacePath) return;
        set((state) => ({
          workspaceBindings: {
            ...state.workspaceBindings,
            [sessionKey]: workspacePath,
          },
          defaultWorkspacePath: workspacePath,
        }));
        try {
          await syncAgentWorkspaceBinding(sessionKey, workspacePath);
        } catch (error) {
          setStoreError(set, error);
        }
      },

      applyWorkspaceForSession: async (sessionKey) => {
        if (!sessionKey) return;
        const state = get();
        const boundPath = state.workspaceBindings[sessionKey] || state.defaultWorkspacePath;
        if (boundPath) {
          try {
            await get().initWorkspace(boundPath);
            await syncAgentWorkspaceBinding(sessionKey, boundPath);
            return;
          } catch {
            // fallthrough to ensure default workspace
          }
        }
        await get().ensureDefaultWorkspaceForSession(sessionKey);
      },

      ensureDefaultWorkspaceForSession: async (sessionKey) => {
        if (!sessionKey) return;
        try {
          const ensuredPath = await invokeIpc<string>('fs:ensure-default-workspace');
          await get().bindWorkspaceToSession(sessionKey, ensuredPath);
          await get().initWorkspace(ensuredPath);
        } catch (error) {
          setStoreError(set, error);
        }
      },

      initWorkspace: async (workspacePath) => {
        await invokeIpc<string>('fs:set-workspace', workspacePath);
        set({
          workspacePath,
          tree: null,
          openFiles: [],
          activeFile: null,
          fileContents: {},
          dirtyFiles: [],
          contextFiles: [],
          lastError: null,
        });
        await get().refreshTree();
      },

      refreshTree: async (dirPath) => {
        try {
          await ensureMainWorkspaceSynced(get);
          const tree = await invokeIpc<FileNode>('fs:read-tree', dirPath);
          const sanitizedTree = sanitizeTreeForUi(tree, get().workspacePath);
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
          const workspace = await ensureMainWorkspaceSynced(get);
          if (!workspace) {
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
          const workspace = await ensureMainWorkspaceSynced(get);
          if (!workspace) {
            set({ isWatching: false, lastError: null });
            return;
          }
          await invokeIpc<boolean>('fs:watch-start');
          removeFsChangedListener = window.electron.fs.onChanged(() => {
            void get().refreshTree();
          });
          set({ isWatching: true, lastError: null });
        } catch (error) {
          // App restart can keep persisted workspacePath in renderer while main process has no selected workspace yet.
          // Try one more sync silently before reporting an error.
          if (isWorkspaceNotSelectedError(error)) {
            const workspace = get().workspacePath;
            if (workspace) {
              try {
                await invokeIpc<string>('fs:set-workspace', workspace);
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
              workspacePath: null,
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
      partialize: (state) => ({
        workspacePath: state.workspacePath,
        defaultWorkspacePath: state.defaultWorkspacePath,
        workspaceBindings: state.workspaceBindings,
      }),
    },
  ),
);
