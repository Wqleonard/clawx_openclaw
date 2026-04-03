/**
 * Settings State Store
 * Manages application settings
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import i18n from '@/i18n';
import { hostApiFetch } from '@/lib/host-api';
import { resolveSupportedLanguage } from '../../shared/language';

type Theme = 'light' | 'dark' | 'system';
type UpdateChannel = 'stable' | 'beta' | 'dev';

interface SettingsState {
  // General
  theme: Theme;
  language: string;
  startMinimized: boolean;
  launchAtStartup: boolean;
  telemetryEnabled: boolean;

  // Gateway
  gatewayAutoStart: boolean;
  gatewayPort: number;
  proxyEnabled: boolean;
  proxyServer: string;
  proxyHttpServer: string;
  proxyHttpsServer: string;
  proxyAllServer: string;
  proxyBypassRules: string;

  // Update
  updateChannel: UpdateChannel;
  autoCheckUpdate: boolean;
  autoDownloadUpdate: boolean;

  // UI State
  sidebarCollapsed: boolean;
  devModeUnlocked: boolean;
  showToolCalls: boolean;
  workspaceRoots: string;

  // Setup
  setupComplete: boolean;

  // Actions
  init: () => Promise<void>;
  setTheme: (theme: Theme) => void;
  setLanguage: (language: string) => void;
  setStartMinimized: (value: boolean) => void;
  setLaunchAtStartup: (value: boolean) => void;
  setTelemetryEnabled: (value: boolean) => void;
  setGatewayAutoStart: (value: boolean) => void;
  setGatewayPort: (port: number) => void;
  setProxyEnabled: (value: boolean) => void;
  setProxyServer: (value: string) => void;
  setProxyHttpServer: (value: string) => void;
  setProxyHttpsServer: (value: string) => void;
  setProxyAllServer: (value: string) => void;
  setProxyBypassRules: (value: string) => void;
  setUpdateChannel: (channel: UpdateChannel) => void;
  setAutoCheckUpdate: (value: boolean) => void;
  setAutoDownloadUpdate: (value: boolean) => void;
  setSidebarCollapsed: (value: boolean) => void;
  setDevModeUnlocked: (value: boolean) => void;
  setShowToolCalls: (value: boolean) => void;
  setSetupComplete: (value: boolean) => void;
  setWorkspaceRoots: (value: string) => void;
  markSetupComplete: () => void;
  resetSettings: () => void;
}

const defaultSettings = {
  theme: 'light' as Theme,
  language: 'zh',
  // theme: 'system' as Theme,
  // language: resolveSupportedLanguage(typeof navigator !== 'undefined' ? navigator.language : undefined),
  startMinimized: false,
  launchAtStartup: false,
  telemetryEnabled: true,
  gatewayAutoStart: true,
  gatewayPort: 18789,
  proxyEnabled: false,
  proxyServer: '',
  proxyHttpServer: '',
  proxyHttpsServer: '',
  proxyAllServer: '',
  proxyBypassRules: '<local>;localhost;127.0.0.1;::1',
  updateChannel: 'stable' as UpdateChannel,
  autoCheckUpdate: true,
  autoDownloadUpdate: false,
  sidebarCollapsed: false,
  devModeUnlocked: false,
  showToolCalls: false,
  workspaceRoots: '',
  setupComplete: false,
};

function ensureWorkspaceRoot(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      ...defaultSettings,

      init: async () => {
        try {
          const settings = await hostApiFetch<Partial<typeof defaultSettings>>('/api/settings');
          const { theme: _theme, ...settingsWithoutTheme } = settings;
          set((state) => ({
            ...state,
            ...settingsWithoutTheme,
            workspaceRoots: ensureWorkspaceRoot((settingsWithoutTheme as { workspaceRoots?: unknown }).workspaceRoots),
          }));
          if (settings.language) {
            i18n.changeLanguage(settings.language);
          }
        } catch {
          // Keep renderer-persisted settings as a fallback when the main
          // process store is not reachable.
        }
      },

      setTheme: (theme) => {
        set({ theme });
        void hostApiFetch('/api/settings/theme', {
          method: 'PUT',
          body: JSON.stringify({ value: theme }),
        }).catch(() => { });
      },
      setLanguage: (language) => {
        const resolvedLanguage = resolveSupportedLanguage(language);
        i18n.changeLanguage(resolvedLanguage);
        set({ language: resolvedLanguage });
        void hostApiFetch('/api/settings/language', {
          method: 'PUT',
          body: JSON.stringify({ value: resolvedLanguage }),
        }).catch(() => { });
      },
      setStartMinimized: (startMinimized) => set({ startMinimized }),
      setLaunchAtStartup: (launchAtStartup) => {
        set({ launchAtStartup });
        void hostApiFetch('/api/settings/launchAtStartup', {
          method: 'PUT',
          body: JSON.stringify({ value: launchAtStartup }),
        }).catch(() => { });
      },
      setTelemetryEnabled: (telemetryEnabled) => {
        set({ telemetryEnabled });
        void hostApiFetch('/api/settings/telemetryEnabled', {
          method: 'PUT',
          body: JSON.stringify({ value: telemetryEnabled }),
        }).catch(() => { });
      },
      setGatewayAutoStart: (gatewayAutoStart) => {
        set({ gatewayAutoStart });
        void hostApiFetch('/api/settings/gatewayAutoStart', {
          method: 'PUT',
          body: JSON.stringify({ value: gatewayAutoStart }),
        }).catch(() => { });
      },
      setGatewayPort: (gatewayPort) => {
        set({ gatewayPort });
        void hostApiFetch('/api/settings/gatewayPort', {
          method: 'PUT',
          body: JSON.stringify({ value: gatewayPort }),
        }).catch(() => { });
      },
      setProxyEnabled: (proxyEnabled) => set({ proxyEnabled }),
      setProxyServer: (proxyServer) => set({ proxyServer }),
      setProxyHttpServer: (proxyHttpServer) => set({ proxyHttpServer }),
      setProxyHttpsServer: (proxyHttpsServer) => set({ proxyHttpsServer }),
      setProxyAllServer: (proxyAllServer) => set({ proxyAllServer }),
      setProxyBypassRules: (proxyBypassRules) => set({ proxyBypassRules }),
      setUpdateChannel: (updateChannel) => set({ updateChannel }),
      setAutoCheckUpdate: (autoCheckUpdate) => set({ autoCheckUpdate }),
      setAutoDownloadUpdate: (autoDownloadUpdate) => set({ autoDownloadUpdate }),
      setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
      setDevModeUnlocked: (devModeUnlocked) => set({ devModeUnlocked }),
      setShowToolCalls: (showToolCalls) => set({ showToolCalls }),
      setSetupComplete: (setupComplete) => set({ setupComplete }),
      setWorkspaceRoots: (workspaceRoots) => {
        set({ workspaceRoots });
        void hostApiFetch('/api/settings/workspaceRoots', {
          method: 'PUT',
          body: JSON.stringify({ value: workspaceRoots }),
        }).catch(() => { });
      },
      markSetupComplete: () => set({ setupComplete: true }),
      resetSettings: () => set(defaultSettings),
    }),
    {
      name: 'claw-settings',
      version: 2,
      migrate: (persistedState, fromVersion) => {
        const state = persistedState as Partial<typeof defaultSettings>;
        // v1: force light theme as new default (only when migrating from old version)
        if (fromVersion < 1 && (!state.theme || state.theme === 'dark' || state.theme === 'system')) {
          state.theme = 'light';
        }
        state.workspaceRoots = ensureWorkspaceRoot(state.workspaceRoots);
        return state;
      },
      partialize: (state) => ({
        theme: state.theme,
        language: state.language,
        startMinimized: state.startMinimized,
        launchAtStartup: state.launchAtStartup,
        telemetryEnabled: state.telemetryEnabled,
        gatewayAutoStart: state.gatewayAutoStart,
        gatewayPort: state.gatewayPort,
        proxyEnabled: state.proxyEnabled,
        proxyServer: state.proxyServer,
        proxyHttpServer: state.proxyHttpServer,
        proxyHttpsServer: state.proxyHttpsServer,
        proxyAllServer: state.proxyAllServer,
        proxyBypassRules: state.proxyBypassRules,
        updateChannel: state.updateChannel,
        autoCheckUpdate: state.autoCheckUpdate,
        autoDownloadUpdate: state.autoDownloadUpdate,
        sidebarCollapsed: state.sidebarCollapsed,
        devModeUnlocked: state.devModeUnlocked,
        showToolCalls: state.showToolCalls,
        workspaceRoots: state.workspaceRoots,
        setupComplete: state.setupComplete,
      }),
    }
  )
);
