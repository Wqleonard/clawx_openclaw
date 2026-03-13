/**
 * Electron API Type Declarations
 * Types for the APIs exposed via contextBridge
 */

export interface IpcRenderer {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
  on(channel: string, callback: (...args: unknown[]) => void): (() => void) | void;
  once(channel: string, callback: (...args: unknown[]) => void): void;
  off(channel: string, callback?: (...args: unknown[]) => void): void;
}

export interface ElectronAPI {
  ipcRenderer: IpcRenderer;
  openExternal: (url: string) => Promise<void>;
  platform: NodeJS.Platform;
  isDev: boolean;
  fs: {
    openFolder: () => Promise<string | null>;
    ensureDefaultWorkspace: () => Promise<string>;
    setWorkspace: (dirPath: string) => Promise<string>;
    getWorkspace: () => Promise<string | null>;
    readTree: (dirPath?: string) => Promise<FileNode>;
    readFile: (filePath: string) => Promise<string>;
    writeFile: (filePath: string, content: string) => Promise<boolean>;
    createFile: (filePath: string) => Promise<boolean>;
    createFolder: (dirPath: string) => Promise<boolean>;
    rename: (oldPath: string, newPath: string) => Promise<boolean>;
    move: (sourcePath: string, targetPath: string) => Promise<boolean>;
    copy: (sourcePath: string, targetPath: string) => Promise<boolean>;
    delete: (targetPath: string) => Promise<boolean>;
    watchStart: (dirPath?: string) => Promise<boolean>;
    watchStop: () => Promise<boolean>;
    addToContext: (filePath: string, agentId?: string) => Promise<boolean>;
    removeFromContext: (filePath: string, agentId?: string) => Promise<boolean>;
    listContext: (agentId?: string) => Promise<string[]>;
    onChanged: (callback: (data: { event: string; path: string }) => void) => () => void;
  };
}

export interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'folder';
  children?: FileNode[];
}

declare global {
  interface Window {
    electron: ElectronAPI;
  }
}

export {};
