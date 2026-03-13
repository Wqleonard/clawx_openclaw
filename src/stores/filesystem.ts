import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { invokeIpc } from '@/lib/api-client';
import type { FileNode } from '@/types/electron';

type FileSystemState = {
  workspacePath: string | null;
  tree: FileNode | null;
  openFiles: string[];
  activeFile: string | null;
  fileContents: Record<string, string>;
  dirtyFiles: string[];
  isWatching: boolean;
  lastError: string | null;

  openFolder: () => Promise<string | null>;
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
  startWatching: () => Promise<void>;
  stopWatching: () => Promise<void>;
  clearError: () => void;
};

let removeFsChangedListener: (() => void) | null = null;

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
      tree: null,
      openFiles: [],
      activeFile: null,
      fileContents: {},
      dirtyFiles: [],
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

      initWorkspace: async (workspacePath) => {
        set({
          workspacePath,
          tree: null,
          openFiles: [],
          activeFile: null,
          fileContents: {},
          dirtyFiles: [],
          lastError: null,
        });
        await get().refreshTree();
      },

      refreshTree: async (dirPath) => {
        try {
          const tree = await invokeIpc<FileNode>('fs:read-tree', dirPath);
          set({ tree, lastError: null });
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
            return {
              openFiles: nextOpen,
              activeFile: state.activeFile === oldPath ? newPath : state.activeFile,
              fileContents: nextContents,
              dirtyFiles: nextDirty,
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
            const nextContents = Object.fromEntries(
              Object.entries(state.fileContents).map(([key, val]) => [remap(key), val]),
            );
            return {
              openFiles: nextOpen,
              activeFile: state.activeFile ? remap(state.activeFile) : null,
              dirtyFiles: nextDirty,
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
            };
          });
          await get().refreshTree();
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
          await invokeIpc<boolean>('fs:watch-start');
          removeFsChangedListener = window.electron.fs.onChanged(() => {
            void get().refreshTree();
          });
          set({ isWatching: true, lastError: null });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          // App restart can keep persisted workspacePath in renderer while main process has no selected workspace yet.
          // In this case, degrade quietly instead of showing a red error banner.
          if (message.includes('Workspace is not selected')) {
            set({
              workspacePath: null,
              tree: null,
              openFiles: [],
              activeFile: null,
              fileContents: {},
              dirtyFiles: [],
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
      }),
    },
  ),
);
