import { BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { watch, type FSWatcher } from 'node:fs';
import { cp, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { getOpenClawConfigDir } from '../../utils/paths';
import { getSetting } from '../../utils/store';

type FileNode = {
  name: string;
  path: string;
  type: 'file' | 'folder';
  children?: FileNode[];
};

const TREE_MAX_DEPTH = 6;
const MAX_READ_FILE_BYTES = 2 * 1024 * 1024; // 2MB safety limit for initial phase
const IGNORED_NAMES = new Set(['.git', 'node_modules', 'dist', 'build']);

let workspaceRoot: string | null = null;
let workspaceWatcher: FSWatcher | null = null;
const CONTEXT_MIRROR_DIR = 'boomclaw-files';

async function applyWorkspaceRootFromValue(configuredRoot: unknown): Promise<void> {
  if (typeof configuredRoot !== 'string' || configuredRoot.trim().length === 0) {
    workspaceRoot = null;
    return;
  }
  const resolved = path.resolve(configuredRoot);
  const dirStat = await stat(resolved);
  if (!dirStat.isDirectory()) {
    workspaceRoot = null;
    return;
  }
  workspaceRoot = resolved;
}

export async function syncWorkspaceRootFromSettings(): Promise<void> {
  const configuredRoot = await getSetting('workspaceRoots');
  await applyWorkspaceRootFromValue(configuredRoot);
}

function normalizeWorkspaceRoot(input: string): string {
  const resolved = path.resolve(input);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function assertWorkspaceSelected(): string {
  if (!workspaceRoot) {
    throw new Error('Workspace is not selected. Call fs:open-folder first.');
  }
  return workspaceRoot;
}

function ensureInWorkspace(targetPath: string): string {
  const rootRaw = assertWorkspaceSelected();
  const root = normalizeWorkspaceRoot(rootRaw);
  const resolved = path.resolve(targetPath);
  const normalizedResolved = process.platform === 'win32' ? resolved.toLowerCase() : resolved;

  const rel = path.relative(root, normalizedResolved);
  const isInside = rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  if (!isInside) {
    throw new Error('Path is outside workspace.');
  }
  return resolved;
}

function normalizeAgentId(input?: string): string {
  const normalized = (input || 'main').trim().toLowerCase();
  if (!normalized) return 'main';
  if (!/^[a-z0-9_-]+$/.test(normalized)) {
    throw new Error('Invalid agent id.');
  }
  return normalized;
}

function resolveContextRoot(agentId?: string): string {
  const normalizedAgentId = normalizeAgentId(agentId);
  return path.join(getOpenClawConfigDir(), 'agents', normalizedAgentId, 'context', CONTEXT_MIRROR_DIR);
}

function toContextFilePath(workspaceFilePath: string, agentId?: string): string {
  const root = assertWorkspaceSelected();
  const rel = path.relative(root, workspaceFilePath);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('Target path is outside workspace.');
  }
  return path.join(resolveContextRoot(agentId), rel);
}

async function listFilesRecursive(dirPath: string): Promise<string[]> {
  const entries = await readdir(dirPath, { withFileTypes: true });
  const result: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      const nested = await listFilesRecursive(fullPath);
      result.push(...nested);
      continue;
    }
    if (entry.isFile()) {
      result.push(fullPath);
    }
  }
  return result;
}

async function readTreeRecursive(dirPath: string, depth = 0): Promise<FileNode> {
  const dirStat = await stat(dirPath);
  const name = path.basename(dirPath);

  if (!dirStat.isDirectory() || depth >= TREE_MAX_DEPTH) {
    return { name, path: dirPath, type: 'file' };
  }

  const entries = await readdir(dirPath, { withFileTypes: true });
  const visible = entries
    .filter((entry) => !entry.name.startsWith('.') && !IGNORED_NAMES.has(entry.name))
    .sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name, 'en');
    });

  const children = await Promise.all(
    visible.map(async (entry) => {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        return readTreeRecursive(fullPath, depth + 1);
      }
      return {
        name: entry.name,
        path: fullPath,
        type: 'file' as const,
      };
    }),
  );

  return {
    name,
    path: dirPath,
    type: 'folder',
    children,
  };
}

export function registerFileSystemHandlers(mainWindow: BrowserWindow): void {
  void syncWorkspaceRootFromSettings().catch(() => {
    workspaceRoot = null;
  });

  const stopWatcher = (): void => {
    if (workspaceWatcher) {
      workspaceWatcher.close();
      workspaceWatcher = null;
    }
  };

  ipcMain.handle('fs:open-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    workspaceRoot = path.resolve(result.filePaths[0]);
    return workspaceRoot;
  });

  ipcMain.handle('fs:get-workspace', async () => {
    if (!workspaceRoot) {
      await syncWorkspaceRootFromSettings().catch(() => {
        workspaceRoot = null;
      });
    }
    return workspaceRoot;
  });

  ipcMain.handle('fs:set-workspace', async (_, dirPath: string) => {
    const target = path.resolve(dirPath);
    const targetStat = await stat(target);
    if (!targetStat.isDirectory()) {
      throw new Error('Workspace target must be a directory.');
    }
    workspaceRoot = target;
    return workspaceRoot;
  });

  ipcMain.handle('fs:read-tree', async (_, dirPath?: string) => {
    const root = assertWorkspaceSelected();
    const target = ensureInWorkspace(dirPath || root);
    return readTreeRecursive(target);
  });

  ipcMain.handle('fs:read-file', async (_, filePath: string) => {
    const target = ensureInWorkspace(filePath);
    const fileStat = await stat(target);
    if (!fileStat.isFile()) {
      throw new Error('Target path is not a file.');
    }
    if (fileStat.size > MAX_READ_FILE_BYTES) {
      throw new Error('File is too large to open in editor.');
    }
    return readFile(target, 'utf-8');
  });

  ipcMain.handle('fs:write-file', async (_, filePath: string, content: string) => {
    const target = ensureInWorkspace(filePath);
    const fileStat = await stat(target);
    if (!fileStat.isFile()) {
      throw new Error('Target path is not a file.');
    }
    await writeFile(target, content, 'utf-8');
    return true;
  });

  ipcMain.handle('fs:create-file', async (_, filePath: string) => {
    const target = ensureInWorkspace(filePath);
    const parentDir = ensureInWorkspace(path.dirname(target));
    const parentStat = await stat(parentDir);
    if (!parentStat.isDirectory()) {
      throw new Error('Parent path is not a directory.');
    }
    await writeFile(target, '', { encoding: 'utf-8', flag: 'wx' });
    return true;
  });

  ipcMain.handle('fs:create-folder', async (_, dirPath: string) => {
    const currentWorkspace = workspaceRoot;
    const resolvedTarget = path.resolve(dirPath);
    console.info('[fs:create-folder] request', {
      workspaceRoot: currentWorkspace,
      requestedPath: dirPath,
      resolvedPath: resolvedTarget,
    });
    const target = ensureInWorkspace(dirPath);
    await mkdir(target, { recursive: false });
    return true;
  });

  ipcMain.handle('fs:rename', async (_, oldPath: string, newPath: string) => {
    const source = ensureInWorkspace(oldPath);
    const target = ensureInWorkspace(newPath);
    const parentDir = ensureInWorkspace(path.dirname(target));
    const parentStat = await stat(parentDir);
    if (!parentStat.isDirectory()) {
      throw new Error('Target parent path is not a directory.');
    }
    await rename(source, target);
    return true;
  });

  ipcMain.handle('fs:move', async (_, sourcePath: string, targetPath: string) => {
    const source = ensureInWorkspace(sourcePath);
    const target = ensureInWorkspace(targetPath);
    const parentDir = ensureInWorkspace(path.dirname(target));
    const parentStat = await stat(parentDir);
    if (!parentStat.isDirectory()) {
      throw new Error('Target parent path is not a directory.');
    }
    await rename(source, target);
    return true;
  });

  ipcMain.handle('fs:copy', async (_, sourcePath: string, targetPath: string) => {
    const source = ensureInWorkspace(sourcePath);
    const target = ensureInWorkspace(targetPath);
    const parentDir = ensureInWorkspace(path.dirname(target));
    const parentStat = await stat(parentDir);
    if (!parentStat.isDirectory()) {
      throw new Error('Target parent path is not a directory.');
    }
    await cp(source, target, { recursive: true, errorOnExist: true, force: false });
    return true;
  });

  ipcMain.handle('fs:delete', async (_, targetPath: string) => {
    const target = ensureInWorkspace(targetPath);
    await shell.trashItem(target);
    return true;
  });

  ipcMain.handle('fs:watch-start', async (_, dirPath?: string) => {
    const root = assertWorkspaceSelected();
    const target = ensureInWorkspace(dirPath || root);
    const targetStat = await stat(target);
    if (!targetStat.isDirectory()) {
      throw new Error('Watch target must be a directory.');
    }

    stopWatcher();

    workspaceWatcher = watch(target, { recursive: true }, (eventType, filename) => {
      if (mainWindow.isDestroyed()) return;
      const safeName = typeof filename === 'string' ? filename : '';
      const changedPath = safeName ? path.join(target, safeName) : target;
      mainWindow.webContents.send('fs:changed', {
        event: eventType,
        path: changedPath,
      });
    });

    workspaceWatcher.on('error', () => {
      stopWatcher();
    });

    return true;
  });

  ipcMain.handle('fs:watch-stop', async () => {
    stopWatcher();
    return true;
  });

  ipcMain.handle('fs:add-to-context', async (_, filePath: string, agentId?: string) => {
    const source = ensureInWorkspace(filePath);
    const sourceStat = await stat(source);
    if (!sourceStat.isFile()) {
      throw new Error('Only files can be added to context.');
    }
    const target = toContextFilePath(source, agentId);
    await mkdir(path.dirname(target), { recursive: true });
    await cp(source, target, { recursive: false, force: true });
    return true;
  });

  ipcMain.handle('fs:remove-from-context', async (_, filePath: string, agentId?: string) => {
    const source = ensureInWorkspace(filePath);
    const target = toContextFilePath(source, agentId);
    await rm(target, { force: true });
    return true;
  });

  ipcMain.handle('fs:list-context', async (_, agentId?: string) => {
    const root = assertWorkspaceSelected();
    const contextRoot = resolveContextRoot(agentId);
    try {
      const dirStat = await stat(contextRoot);
      if (!dirStat.isDirectory()) return [];
      const files = await listFilesRecursive(contextRoot);
      return files
        .map((file) => path.relative(contextRoot, file))
        .filter((rel) => rel && !rel.startsWith('..') && !path.isAbsolute(rel))
        .map((rel) => path.join(root, rel));
    } catch {
      return [];
    }
  });
}
