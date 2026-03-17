import { create } from 'zustand';

type ChatLayoutState = {
  isFileTreeDrawerOpen: boolean;
  setFileTreeDrawerOpen: (open: boolean) => void;
  toggleFileTreeDrawer: () => void;
};

export const useChatLayoutStore = create<ChatLayoutState>((set) => ({
  isFileTreeDrawerOpen: false,
  setFileTreeDrawerOpen: (open) => {
    set({ isFileTreeDrawerOpen: open });
  },
  toggleFileTreeDrawer: () => {
    set((state) => ({ isFileTreeDrawerOpen: !state.isFileTreeDrawerOpen }));
  },
}));
