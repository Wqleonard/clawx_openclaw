import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  FilePlus,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  RefreshCcw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import { invokeIpc } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { useFileSystemStore } from '@/stores/filesystem';
import { useChatStore } from '@/stores/chat';
import type { FileNode } from '@/types/electron';

type FileTreeProps = {
  className?: string;
};

const expandedByWorkspaceCache = new Map<string, string[]>();

type MenuAction =
  | 'new_file'
  | 'new_md_file'
  | 'new_folder'
  | 'rename'
  | 'delete'
  | 'open_in_file_manager'
  | 'cut'
  | 'copy'
  | 'paste'
  | 'move_to'
  | 'add_to_context'
  | 'remove_from_context';
type InputAction = 'new_file' | 'new_folder' | 'rename' | 'move_to';

type ContextMenuState = {
  x: number;
  y: number;
  node: FileNode;
};

type ClipboardItem = {
  mode: 'copy' | 'cut';
  nodePath: string;
};

type InputModalState = {
  open: boolean;
  action: InputAction;
  title: string;
  placeholder: string;
  value: string;
  targetPath: string;
};

function isWindowsPath(pathValue: string): boolean {
  return pathValue.includes('\\');
}

function joinPath(base: string, part: string): string {
  const separator = isWindowsPath(base) ? '\\' : '/';
  const normalizedBase = base.replace(/[\\/]+$/, '');
  const normalizedPart = part.replace(/^[\\/]+/, '');
  return `${normalizedBase}${separator}${normalizedPart}`;
}

function dirnamePath(pathValue: string): string {
  const idx = Math.max(pathValue.lastIndexOf('/'), pathValue.lastIndexOf('\\'));
  return idx <= 0 ? pathValue : pathValue.slice(0, idx);
}

function splitFileName(inputName: string): { stem: string; ext: string } {
  const trimmed = inputName.trim();
  const dotIndex = trimmed.lastIndexOf('.');
  if (dotIndex <= 0 || dotIndex === trimmed.length - 1) {
    return { stem: trimmed, ext: '' };
  }
  return {
    stem: trimmed.slice(0, dotIndex),
    ext: trimmed.slice(dotIndex),
  };
}

function resolveUniqueName(
  targetDir: string,
  rawName: string,
  entryType: 'file' | 'folder',
  existingPathSet: Set<string>,
): string {
  const normalizedName = rawName.trim();
  if (!normalizedName) return normalizedName;

  const { stem, ext } = splitFileName(normalizedName);
  const baseName = entryType === 'file' ? stem : normalizedName;
  const extension = entryType === 'file' ? ext : '';
  const buildName = (suffix?: number) =>
    suffix === undefined ? `${baseName}${extension}` : `${baseName}${suffix}${extension}`;

  let candidate = buildName();
  let candidatePath = joinPath(targetDir, candidate);
  if (!existingPathSet.has(candidatePath)) {
    return candidate;
  }

  let counter = 1;
  while (true) {
    candidate = buildName(counter);
    candidatePath = joinPath(targetDir, candidate);
    if (!existingPathSet.has(candidatePath)) {
      return candidate;
    }
    counter += 1;
  }
}

function FileTreeNode({
  node,
  level,
  expanded,
  toggleExpanded,
  contextPathSet,
  onSelectNode,
  onOpenFile,
  onContextMenu,
}: {
  node: FileNode;
  level: number;
  expanded: Set<string>;
  toggleExpanded: (path: string) => void;
  contextPathSet: Set<string>;
  onSelectNode: (node: FileNode) => void;
  onOpenFile: (filePath: string) => void;
  onContextMenu: (event: React.MouseEvent, node: FileNode) => void;
}) {
  const isFolder = node.type === 'folder';
  const isOpen = expanded.has(node.path);
  const hasChildren = !!node.children?.length;
  const isInContext = !isFolder && contextPathSet.has(node.path);

  return (
    <div>
      <button
        type="button"
        onClick={() => {
          onSelectNode(node);
          if (isFolder) {
            toggleExpanded(node.path);
            return;
          }
          onOpenFile(node.path);
        }}
        onContextMenu={(event) => onContextMenu(event, node)}
        className={cn(
          'flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors',
          'hover:bg-black/5 dark:hover:bg-white/5'
        )}
        style={{ paddingLeft: `${8 + level * 14}px` }}
      >
        {isFolder ? (
          hasChildren ? (
            isOpen ? (
              <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            )
          ) : (
            <span className="inline-block h-3.5 w-3.5 shrink-0" />
          )
        ) : (
          <span className="inline-block h-3.5 w-3.5 shrink-0" />
        )}

        {isFolder ? (
          isOpen ? (
            <FolderOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          )
        ) : (
          <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        )}

        <span className={cn('truncate text-foreground/80', isInContext && 'text-primary')}>
          {node.name}
        </span>
      </button>

      {isFolder &&
        isOpen &&
        node.children?.map((child) => (
          <FileTreeNode
            key={child.path}
            node={child}
            level={level + 1}
            expanded={expanded}
            toggleExpanded={toggleExpanded}
            contextPathSet={contextPathSet}
            onSelectNode={onSelectNode}
            onOpenFile={onOpenFile}
            onContextMenu={onContextMenu}
          />
        ))}
    </div>
  );
}

export function FileTree({ className }: FileTreeProps) {
  const { t } = useTranslation('chat');
  const workspacePath = useFileSystemStore((s) => s.projectPath);
  const tree = useFileSystemStore((s) => s.tree);
  const contextFiles = useFileSystemStore((s) => s.contextFiles);
  const lastError = useFileSystemStore((s) => s.lastError);
  const refreshTree = useFileSystemStore((s) => s.refreshTree);
  const openFile = useFileSystemStore((s) => s.openFile);
  const clearError = useFileSystemStore((s) => s.clearError);
  const startWatching = useFileSystemStore((s) => s.startWatching);
  const stopWatching = useFileSystemStore((s) => s.stopWatching);
  const createFile = useFileSystemStore((s) => s.createFile);
  const createFolder = useFileSystemStore((s) => s.createFolder);
  const renameNode = useFileSystemStore((s) => s.renameNode);
  const moveNode = useFileSystemStore((s) => s.moveNode);
  const copyNode = useFileSystemStore((s) => s.copyNode);
  const deleteNode = useFileSystemStore((s) => s.deleteNode);
  const addToContext = useFileSystemStore((s) => s.addToContext);
  const removeFromContext = useFileSystemStore((s) => s.removeFromContext);
  const loadContextFiles = useFileSystemStore((s) => s.loadContextFiles);
  const currentAgentId = useChatStore((s) => s.currentAgentId);

  const [expanded, setExpanded] = useState<Set<string>>(() => {
    if (!workspacePath) return new Set();
    const cached = expandedByWorkspaceCache.get(workspacePath);
    return new Set(cached ?? []);
  });
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [clipboardItem, setClipboardItem] = useState<ClipboardItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<FileNode | null>(null);
  const [selectedNode, setSelectedNode] = useState<FileNode | null>(null);
  const fileTreeRef = useRef<HTMLElement | null>(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const [dialogContainer, setDialogContainer] = useState<HTMLElement | null>(null);
  const [inputModal, setInputModal] = useState<InputModalState>({
    open: false,
    action: 'new_file',
    title: '',
    placeholder: '',
    value: '',
    targetPath: '',
  });

  const labels = useMemo(
    () => ({
      title: t('fileTree.title'),
      noWorkspace: t('fileTree.noWorkspace'),
      emptyFolder: t('fileTree.emptyFolder'),
      openFolder: t('fileTree.openFolder'),
      refresh: t('fileTree.refresh'),
      newFile: t('fileTree.newFile'),
      newMarkdownFile: t('fileTree.newMarkdownFile'),
      newFolder: t('fileTree.newFolder'),
      rename: t('fileTree.rename'),
      openInFileManager: t('fileTree.openInFileManager'),
      moveTo: t('fileTree.moveTo'),
      delete: t('fileTree.delete'),
      createNamePrompt: t('fileTree.createNamePrompt'),
      renamePrompt: t('fileTree.renamePrompt'),
      movePrompt: t('fileTree.movePrompt'),
      deleteConfirm: t('fileTree.deleteConfirm'),
      cut: t('fileTree.cut'),
      copy: t('fileTree.copy'),
      paste: t('fileTree.paste'),
      cancel: t('fileTree.cancel'),
      confirm: t('fileTree.confirm'),
      operationFailed: t('fileTree.operationFailed'),
      targetExists: t('fileTree.targetExists'),
      addToContext: t('fileTree.addToContext'),
      removeFromContext: t('fileTree.removeFromContext'),
    }),
    [t]
  );
  const defaultNewFolderName = t('fileTree.defaultNewFolderName');
  const rootChildren = tree?.type === 'folder' ? tree.children || [] : [];
  const contextPathSet = useMemo(() => new Set(contextFiles), [contextFiles]);
  const pathSet = useMemo(() => {
    const set = new Set<string>();
    const walk = (node: FileNode | null) => {
      if (!node) return;
      set.add(node.path);
      node.children?.forEach(walk);
    };
    walk(tree);
    return set;
  }, [tree]);

  const toggleExpanded = (targetPath: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(targetPath)) next.delete(targetPath);
      else next.add(targetPath);
      return next;
    });
  };

  const openInputModal = useCallback(
    (action: InputAction, targetPath: string, defaultValue = '') => {
      const titleByAction: Record<InputAction, string> = {
        new_file: labels.newFile,
        new_folder: labels.newFolder,
        rename: labels.rename,
        move_to: labels.moveTo,
      };
      const placeholderByAction: Record<InputAction, string> = {
        new_file: labels.createNamePrompt,
        new_folder: labels.createNamePrompt,
        rename: labels.renamePrompt,
        move_to: labels.movePrompt,
      };
      setInputModal({
        open: true,
        action,
        title: titleByAction[action],
        placeholder: placeholderByAction[action],
        value: defaultValue,
        targetPath,
      });
    },
    [
      labels.createNamePrompt,
      labels.movePrompt,
      labels.moveTo,
      labels.newFile,
      labels.newFolder,
      labels.rename,
      labels.renamePrompt,
    ]
  );

  const closeInputModal = () => setInputModal((prev) => ({ ...prev, open: false, value: '' }));

  const onContextMenu = (event: React.MouseEvent, node: FileNode) => {
    event.preventDefault();
    event.stopPropagation();
    setSelectedNode(node);
    const boundary = fileTreeRef.current?.getBoundingClientRect();
    const fixedX = (boundary?.left ?? 0) + 8;
    setContextMenu({
      x: fixedX,
      y: event.clientY - 44,
      node,
    });
  };

  const alertError = useCallback(
    (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      window.alert(`${labels.operationFailed}: ${message}`);
    },
    [labels.operationFailed]
  );

  const runMenuAction = async (action: MenuAction) => {
    const menu = contextMenu;
    if (!menu) return;
    const { node } = menu;
    const targetDir = node.type === 'folder' ? node.path : dirnamePath(node.path);
    setContextMenu(null);

    try {
      if (action === 'new_file') return openInputModal('new_file', targetDir, 'untitled.txt');
      if (action === 'new_md_file') return openInputModal('new_file', targetDir, 'untitled.md');
      if (action === 'new_folder') {
        return openInputModal('new_folder', targetDir, defaultNewFolderName);
      }
      if (action === 'rename') return openInputModal('rename', node.path, node.name);
      if (action === 'open_in_file_manager') {
        if (node.type === 'folder') {
          await invokeIpc('shell:openPath', node.path);
          return;
        }
        await invokeIpc('shell:showItemInFolder', node.path);
        return;
      }
      if (action === 'move_to') return openInputModal('move_to', node.path, node.path);
      if (action === 'delete') return setDeleteTarget(node);
      if (action === 'cut') return setClipboardItem({ mode: 'cut', nodePath: node.path });
      if (action === 'copy') return setClipboardItem({ mode: 'copy', nodePath: node.path });
      if (action === 'add_to_context') {
        if (node.type !== 'file') return;
        await addToContext(node.path, currentAgentId);
        return;
      }
      if (action === 'remove_from_context') {
        if (node.type !== 'file') return;
        await removeFromContext(node.path, currentAgentId);
        return;
      }
      if (action === 'paste' && clipboardItem) {
        const pasteTargetDir = node.type === 'folder' ? node.path : dirnamePath(node.path);
        const sourceName = clipboardItem.nodePath.split(/[\\/]/).pop() || 'item';
        const destinationPath = joinPath(pasteTargetDir, sourceName);
        if (pathSet.has(destinationPath)) {
          throw new Error(labels.targetExists);
        }
        if (clipboardItem.mode === 'copy') await copyNode(clipboardItem.nodePath, destinationPath);
        else {
          await moveNode(clipboardItem.nodePath, destinationPath);
          setClipboardItem(null);
        }
      }
    } catch (error) {
      alertError(error);
    }
  };

  const submitInputModal = async () => {
    const value = inputModal.value.trim();
    if (!value) return;
    try {
      if (inputModal.action === 'new_file') {
        const uniqueName = resolveUniqueName(inputModal.targetPath, value, 'file', pathSet);
        await createFile(joinPath(inputModal.targetPath, uniqueName));
      } else if (inputModal.action === 'new_folder') {
        const uniqueName = resolveUniqueName(inputModal.targetPath, value, 'folder', pathSet);
        await createFolder(joinPath(inputModal.targetPath, uniqueName));
      }
      else if (inputModal.action === 'rename') {
        const renameTargetPath = joinPath(dirnamePath(inputModal.targetPath), value);
        if (pathSet.has(renameTargetPath) && renameTargetPath !== inputModal.targetPath) {
          throw new Error(labels.targetExists);
        }
        await renameNode(inputModal.targetPath, renameTargetPath);
      } else if (inputModal.action === 'move_to') {
        if (!workspacePath) return;
        const nextPath = /^[A-Za-z]:\\|^\//.test(value) ? value : joinPath(workspacePath, value);
        if (pathSet.has(nextPath) && nextPath !== inputModal.targetPath) {
          throw new Error(labels.targetExists);
        }
        await moveNode(inputModal.targetPath, nextPath);
      }
      closeInputModal();
    } catch (error) {
      alertError(error);
    }
  };

  useEffect(() => {
    setDialogContainer(document.body);
  }, []);

  useEffect(() => {
    if (!workspacePath) {
      setExpanded(new Set());
      return;
    }
    const cached = expandedByWorkspaceCache.get(workspacePath);
    setExpanded(new Set(cached ?? []));
  }, [workspacePath]);

  useEffect(() => {
    if (!workspacePath) return;
    expandedByWorkspaceCache.set(workspacePath, Array.from(expanded));
  }, [workspacePath, expanded]);

  useEffect(() => {
    if (!workspacePath) return;
    void loadContextFiles(currentAgentId);
  }, [workspacePath, currentAgentId, loadContextFiles]);

  useEffect(() => {
    if (!workspacePath) return;
    void startWatching();
    return () => {
      void stopWatching();
    };
  }, [workspacePath, startWatching, stopWatching]);

  useEffect(() => {
    if (!contextMenu) return;

    const closeMenu = () => setContextMenu(null);
    const closeMenuOnOutsideMouseDown = (event: MouseEvent) => {
      // Keep context menu stable when right-clicking to reopen on another node.
      if (event.button === 2) return;
      const target = event.target as Node | null;
      if (target && contextMenuRef.current?.contains(target)) return;
      setContextMenu(null);
    };
    const closeMenuOnKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setContextMenu(null);
      }
    };

    window.addEventListener('mousedown', closeMenuOnOutsideMouseDown);
    window.addEventListener('scroll', closeMenu, true);
    window.addEventListener('resize', closeMenu);
    window.addEventListener('keydown', closeMenuOnKeyDown);
    return () => {
      window.removeEventListener('mousedown', closeMenuOnOutsideMouseDown);
      window.removeEventListener('scroll', closeMenu, true);
      window.removeEventListener('resize', closeMenu);
      window.removeEventListener('keydown', closeMenuOnKeyDown);
    };
  }, [contextMenu]);

  useLayoutEffect(() => {
    if (!contextMenu || !contextMenuRef.current) return;
    const menuRect = contextMenuRef.current.getBoundingClientRect();
    const boundary = fileTreeRef.current?.getBoundingClientRect();
    const viewportPadding = 8;
    const minX = (boundary?.left ?? 0) + viewportPadding;
    const minY = (boundary?.top ?? 0) + viewportPadding;
    const maxY = (boundary?.bottom ?? window.innerHeight) - menuRect.height - viewportPadding;
    const nextX = minX;
    const nextY = Math.max(minY, Math.min(contextMenu.y, Math.max(minY, maxY)));
    if (nextX === contextMenu.x && nextY === contextMenu.y) return;
    setContextMenu((prev) => (prev ? { ...prev, x: nextX, y: nextY } : prev));
  }, [contextMenu]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      ) {
        return;
      }
      if (!selectedNode) return;

      const metaOrCtrl = event.metaKey || event.ctrlKey;
      if (event.key === 'F2') {
        event.preventDefault();
        openInputModal('rename', selectedNode.path, selectedNode.name);
        return;
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        setDeleteTarget(selectedNode);
        return;
      }
      if (metaOrCtrl && event.key.toLowerCase() === 'c') {
        event.preventDefault();
        setClipboardItem({ mode: 'copy', nodePath: selectedNode.path });
        return;
      }
      if (metaOrCtrl && event.key.toLowerCase() === 'x') {
        event.preventDefault();
        setClipboardItem({ mode: 'cut', nodePath: selectedNode.path });
        return;
      }
      if (metaOrCtrl && event.key.toLowerCase() === 'v' && clipboardItem) {
        event.preventDefault();
        const targetDir =
          selectedNode.type === 'folder' ? selectedNode.path : dirnamePath(selectedNode.path);
        const sourceName = clipboardItem.nodePath.split(/[\\/]/).pop() || 'item';
        const destinationPath = joinPath(targetDir, sourceName);
        if (pathSet.has(destinationPath)) {
          alertError(new Error(labels.targetExists));
          return;
        }
        if (clipboardItem.mode === 'copy') {
          void copyNode(clipboardItem.nodePath, destinationPath);
        } else {
          void moveNode(clipboardItem.nodePath, destinationPath).then(() => setClipboardItem(null));
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [
    selectedNode,
    clipboardItem,
    pathSet,
    labels.targetExists,
    copyNode,
    moveNode,
    alertError,
    openInputModal,
  ]);

  const menuStyle = contextMenu
    ? {
        left: 8,
        top: contextMenu.y,
      }
    : undefined;

  return (
    <section
      ref={fileTreeRef}
      className={cn(
        'flex h-full min-h-0 flex-col border-r bg-[#eae8e1]/45 dark:bg-background',
        className
      )}
    >
      <div className="flex items-center justify-end border-b px-2 py-2 h-11">
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            title={labels.newFile}
            onClick={() =>
              workspacePath && openInputModal('new_file', workspacePath, 'untitled.md')
            }
          >
            <FilePlus className="h-3.5 w-3.5 text-muted-foreground" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            title={labels.newFolder}
            onClick={() =>
              workspacePath && openInputModal('new_folder', workspacePath, defaultNewFolderName)
            }
          >
            <FolderPlus className="h-3.5 w-3.5 text-muted-foreground" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            title={labels.refresh}
            onClick={() => {
              void refreshTree();
            }}
          >
            <RefreshCcw className="h-3.5 w-3.5 text-muted-foreground" />
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-1.5">
        {!workspacePath && (
          <div className="px-2 py-4 text-xs text-muted-foreground">{labels.noWorkspace}</div>
        )}
        {!!workspacePath && rootChildren.length === 0 && (
          <div className="px-2 py-4 text-xs text-muted-foreground">{labels.emptyFolder}</div>
        )}
        {rootChildren.map((node) => (
          <FileTreeNode
            key={node.path}
            node={node}
            level={0}
            expanded={expanded}
            toggleExpanded={toggleExpanded}
            contextPathSet={contextPathSet}
            onSelectNode={(nodeValue) => setSelectedNode(nodeValue)}
            onOpenFile={(filePath) => {
              void openFile(filePath);
            }}
            onContextMenu={onContextMenu}
          />
        ))}
      </div>

      {lastError && (
        <div className="border-t px-2 py-1.5 text-[11px] text-destructive">
          <button
            type="button"
            className="max-w-full truncate text-left underline underline-offset-2"
            title={lastError}
            onClick={clearError}
          >
            {lastError}
          </button>
        </div>
      )}

      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="fixed z-50 min-w-36 max-w-50 rounded-md border bg-background p-1 shadow-md"
          style={menuStyle}
          onMouseDown={(event) => {
            event.stopPropagation();
          }}
          onContextMenu={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
        >
          {contextMenu.node.type === 'folder' && (
            <>
              {/* <button
                type="button"
                className="w-full rounded px-2 py-1 text-left text-sm hover:bg-muted"
                onClick={() => {
                  void runMenuAction('new_file');
                }}
              >
                {labels.newFile}
              </button> */}
              <button
                type="button"
                className="w-full rounded px-2 py-1 text-left text-sm hover:bg-muted"
                onClick={() => {
                  void runMenuAction('new_md_file');
                }}
              >
                {labels.newFile}
              </button>
              <button
                type="button"
                className="w-full rounded px-2 py-1 text-left text-sm hover:bg-muted"
                onClick={() => {
                  void runMenuAction('new_folder');
                }}
              >
                {labels.newFolder}
              </button>
            </>
          )}
          <button
            type="button"
            className="w-full rounded px-2 py-1 text-left text-sm hover:bg-muted"
            onClick={() => {
              void runMenuAction('rename');
            }}
          >
            {labels.rename}
          </button>
          <button
            type="button"
            className="w-full rounded px-2 py-1 text-left text-sm hover:bg-muted"
            onClick={() => {
              void runMenuAction('open_in_file_manager');
            }}
          >
            {labels.openInFileManager}
          </button>
          {/* <button
            type="button"
            className="w-full rounded px-2 py-1 text-left text-sm hover:bg-muted"
            onClick={() => {
              void runMenuAction('move_to');
            }}
          >
            {labels.moveTo}
          </button>
          <button
            type="button"
            className="w-full rounded px-2 py-1 text-left text-sm hover:bg-muted"
            onClick={() => {
              void runMenuAction('copy');
            }}
          >
            {labels.copy}
          </button>
          <button
            type="button"
            className="w-full rounded px-2 py-1 text-left text-sm hover:bg-muted"
            onClick={() => {
              void runMenuAction('cut');
            }}
          >
            {labels.cut}
          </button> */}
          {/* {contextMenu.node.type === 'file' &&
            (contextPathSet.has(contextMenu.node.path) ? (
              <button
                type="button"
                className="w-full rounded px-2 py-1 text-left text-sm hover:bg-muted"
                onClick={() => {
                  void runMenuAction('remove_from_context');
                }}
              >
                {labels.removeFromContext}
              </button>
            ) : (
              <button
                type="button"
                className="w-full rounded px-2 py-1 text-left text-sm hover:bg-muted"
                onClick={() => {
                  void runMenuAction('add_to_context');
                }}
              >
                {labels.addToContext}
              </button>
            ))} */}
          {/* {contextMenu.node.type === 'folder' && clipboardItem && (
            <button
              type="button"
              className="w-full rounded px-2 py-1 text-left text-sm hover:bg-muted"
              onClick={() => {
                void runMenuAction('paste');
              }}
            >
              {labels.paste}
            </button>
          )} */}
          <button
            type="button"
            className="w-full rounded px-2 py-1 text-left text-sm text-destructive hover:bg-destructive/10"
            onClick={() => {
              void runMenuAction('delete');
            }}
          >
            {labels.delete}
          </button>
        </div>
      )}

      <Dialog
        open={inputModal.open}
        onOpenChange={(open) => {
          if (!open) closeInputModal();
        }}
      >
        <DialogContent container={dialogContainer} className="w-[400px] max-w-[400px]">
          <DialogHeader>
            <DialogTitle>{inputModal.title}</DialogTitle>
          </DialogHeader>
          <Input
            value={inputModal.value}
            placeholder={inputModal.placeholder}
            onChange={(event) => setInputModal((prev) => ({ ...prev, value: event.target.value }))}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void submitInputModal();
              }
            }}
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={closeInputModal}>
              {labels.cancel}
            </Button>
            <Button
              onClick={() => {
                void submitInputModal();
              }}
            >
              {labels.confirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <DialogContent container={dialogContainer} className="w-[400px] max-w-[400px]">
          <DialogHeader>
            <DialogTitle>{labels.delete}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{labels.deleteConfirm}</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              {labels.cancel}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (!deleteTarget) return;
                void deleteNode(deleteTarget.path);
                setDeleteTarget(null);
              }}
            >
              {labels.confirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
