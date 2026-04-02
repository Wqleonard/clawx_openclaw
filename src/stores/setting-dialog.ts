import { create } from 'zustand';

type SettingDialogState = {
  open: boolean;
  setOpen: (open: boolean) => void;
  openDialog: () => void;
  closeDialog: () => void;
};

export const useSettingDialogStore = create<SettingDialogState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
  openDialog: () => set({ open: true }),
  closeDialog: () => set({ open: false }),
}));
