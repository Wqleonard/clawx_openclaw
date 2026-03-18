import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const CHAT_PANEL_SIZE = {
  list: {
    min: 220,
    max: 520,
    default: 280,
  },
  editor: {
    min: 260,
    max: 900,
    default: 560,
  },
  fileTree: {
    min: 220,
    max: 520,
    default: 260,
  },
  chatMinWidth: 420,
} as const;

type ChatStyleState = {
  listWidth: number;
  editorWidth: number;
  fileTreeWidth: number;
  setListWidth: (width: number) => void;
  setEditorWidth: (width: number) => void;
  setFileTreeWidth: (width: number) => void;
  resetPanelWidths: () => void;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export const useChatStyleStore = create<ChatStyleState>()(
  persist(
    (set) => ({
      listWidth: CHAT_PANEL_SIZE.list.default,
      editorWidth: CHAT_PANEL_SIZE.editor.default,
      fileTreeWidth: CHAT_PANEL_SIZE.fileTree.default,
      setListWidth: (width) => {
        set({
          listWidth: clamp(width, CHAT_PANEL_SIZE.list.min, CHAT_PANEL_SIZE.list.max),
        });
      },
      setEditorWidth: (width) => {
        set({
          editorWidth: clamp(width, CHAT_PANEL_SIZE.editor.min, CHAT_PANEL_SIZE.editor.max),
        });
      },
      setFileTreeWidth: (width) => {
        set({
          fileTreeWidth: clamp(width, CHAT_PANEL_SIZE.fileTree.min, CHAT_PANEL_SIZE.fileTree.max),
        });
      },
      resetPanelWidths: () => {
        set({
          listWidth: CHAT_PANEL_SIZE.list.default,
          editorWidth: CHAT_PANEL_SIZE.editor.default,
          fileTreeWidth: CHAT_PANEL_SIZE.fileTree.default,
        });
      },
    }),
    {
      name: 'chat-style-store',
      version: 1,
      partialize: (state) => ({
        listWidth: state.listWidth,
        editorWidth: state.editorWidth,
        fileTreeWidth: state.fileTreeWidth,
      }),
    }
  )
);
