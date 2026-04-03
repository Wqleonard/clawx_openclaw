/**
 * Provider 状态管理 Store
 * 统一管理模型提供商账户配置
 */
import { create } from 'zustand';
import {
  BaowenmaoPresetAccount,
  BAOWENMAO_PRESET_ACCOUNTS,
  ManagedGooglePresetAccount,
  ProviderAccount,
  ProviderConfig,
  ProviderVendorInfo,
  ProviderWithKeyInfo,
  MANAGED_GOOGLE_PRESET_ACCOUNTS,
} from '@/lib/providers';
import { getModels } from '@/api/users';
import { hostApiFetch } from '@/lib/host-api';
import {
  buildEnabledProviderModels,
  fetchProviderSnapshot,
  resolveCurrentEffectiveProviderModel,
  type EnabledProviderModel,
} from '@/lib/provider-accounts';

// 兼容历史引用：从此处二次导出类型
export type {
  ProviderAccount,
  ProviderConfig,
  ProviderVendorInfo,
  ProviderWithKeyInfo,
} from '@/lib/providers';
export type { EnabledProviderModel, ProviderSnapshot } from '@/lib/provider-accounts';

interface ProviderState {
  statuses: ProviderWithKeyInfo[];
  accounts: ProviderAccount[];
  vendors: ProviderVendorInfo[];
  defaultAccountId: string | null;
  loading: boolean;
  error: string | null;
  // Actions
  init: () => Promise<void>;
  refreshProviderSnapshot: () => Promise<void>;
  createAccount: (account: ProviderAccount, apiKey?: string) => Promise<void>;
  removeAccount: (accountId: string) => Promise<void>;
  validateAccountApiKey: (
    accountId: string,
    apiKey: string,
    options?: { baseUrl?: string; apiProtocol?: ProviderAccount['apiProtocol'] }
  ) => Promise<{ valid: boolean; error?: string }>;
  getAccountApiKey: (accountId: string) => Promise<string | null>;

  // 历史兼容别名
  fetchProviders: () => Promise<void>;
  addProvider: (config: Omit<ProviderConfig, 'createdAt' | 'updatedAt'>, apiKey?: string) => Promise<void>;
  addAccount: (account: ProviderAccount, apiKey?: string) => Promise<void>;
  updateProvider: (providerId: string, updates: Partial<ProviderConfig>, apiKey?: string) => Promise<void>;
  updateAccount: (accountId: string, updates: Partial<ProviderAccount>, apiKey?: string) => Promise<void>;
  deleteProvider: (providerId: string) => Promise<void>;
  deleteAccount: (accountId: string) => Promise<void>;
  setApiKey: (providerId: string, apiKey: string) => Promise<void>;
  updateProviderWithKey: (
    providerId: string,
    updates: Partial<ProviderConfig>,
    apiKey?: string
  ) => Promise<void>;
  deleteApiKey: (providerId: string) => Promise<void>;
  setDefaultProvider: (providerId: string) => Promise<void>;
  setDefaultAccount: (accountId: string) => Promise<void>;
  validateApiKey: (
    providerId: string,
    apiKey: string,
    options?: { baseUrl?: string; apiProtocol?: ProviderAccount['apiProtocol'] }
  ) => Promise<{ valid: boolean; error?: string }>;
  getApiKey: (providerId: string) => Promise<string | null>;
  /**
   * Chat 模型选择器数据源：
   * 返回所有“已启用且凭证可用”的模型。
   */
  getEnabledProviderModels: () => EnabledProviderModel[];
  /**
   * 获取当前运行时/Chat 生效模型：
   * 优先级：默认账号（可用）-> 首个可用且已启用账号。
   */
  getCurrentEffectiveProviderModel: () => EnabledProviderModel | null;
  /**
   * 切换当前模型（通过切换默认 Provider 账号实现）：
   * 约束：目标账号必须在“已启用且可用”列表中。
   */
  switchCurrentProviderModel: (accountId: string) => Promise<void>;
  /**
   * 登录后初始化爆文猫预置模型：
   * 对预置账号执行 upsert、启用，并设置预置默认账号。
   */
  ensureBaowenmaoPresetAccounts: (apiKey: string) => Promise<void>;
  /** 登录后把业务 token 同步到 Google 受管代理账号。 */
  ensureManagedGoogleProxyAccount: (apiKey: string) => Promise<void>;
}

const BAOWENMAO_PROTOCOL: ProviderAccount['apiProtocol'] = 'openai-completions';
const MANAGED_GOOGLE_PROTOCOL: ProviderAccount['apiProtocol'] = 'google-generative-ai';

function resolveBusinessApiBaseUrl(): string {
  const raw = (import.meta.env.VITE_BUSINESS_API_BASE_URL as string | undefined)?.trim() ?? '';
  return raw.replace(/\/+$/, '');
}

export const useProviderStore = create<ProviderState>((set, get) => ({
  statuses: [],
  accounts: [],
  vendors: [],
  defaultAccountId: null,
  loading: false,
  error: null,

  init: async () => {
    await get().refreshProviderSnapshot();
  },

  refreshProviderSnapshot: async () => {
    set({ loading: true, error: null });
    
    try {
      const snapshot = await fetchProviderSnapshot();
      console.log('snapshot', snapshot);
      
      set({ 
        statuses: snapshot.statuses ?? [],
        accounts: snapshot.accounts ?? [],
        vendors: snapshot.vendors ?? [],
        defaultAccountId: snapshot.defaultAccountId ?? null,
        loading: false 
      });
    } catch (error) {
      set({ error: String(error), loading: false });
    }
  },

  fetchProviders: async () => get().refreshProviderSnapshot(),
  
  addProvider: async (config, apiKey) => {
    try {
      const fullConfig: ProviderConfig = {
        ...config,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      
      const result = await hostApiFetch<{ success: boolean; error?: string }>('/api/providers', {
        method: 'POST',
        body: JSON.stringify({ config: fullConfig, apiKey }),
      });
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to save provider');
      }
      
      // 刷新列表
      await get().refreshProviderSnapshot();
    } catch (error) {
      console.error('Failed to add provider:', error);
      throw error;
    }
  },

  createAccount: async (account, apiKey) => {
    try {
      const result = await hostApiFetch<{ success: boolean; error?: string }>('/api/provider-accounts', {
        method: 'POST',
        body: JSON.stringify({ account, apiKey }),
      });

      if (!result.success) {
        throw new Error(result.error || 'Failed to create provider account');
      }

      await get().refreshProviderSnapshot();
    } catch (error) {
      console.error('Failed to add account:', error);
      throw error;
    }
  },

  addAccount: async (account, apiKey) => get().createAccount(account, apiKey),
  
  updateProvider: async (providerId, updates, apiKey) => {
    try {
      const existing = get().statuses.find((p) => p.id === providerId);
      if (!existing) {
        throw new Error('Provider not found');
      }

      const { hasKey: _hasKey, keyMasked: _keyMasked, ...providerConfig } = existing;
      
      const updatedConfig: ProviderConfig = {
        ...providerConfig,
        ...updates,
        updatedAt: new Date().toISOString(),
      };
      
      const result = await hostApiFetch<{ success: boolean; error?: string }>(`/api/providers/${encodeURIComponent(providerId)}`, {
        method: 'PUT',
        body: JSON.stringify({ updates: updatedConfig, apiKey }),
      });
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to update provider');
      }
      
      // 刷新列表
      await get().refreshProviderSnapshot();
    } catch (error) {
      console.error('Failed to update provider:', error);
      throw error;
    }
  },

  updateAccount: async (accountId, updates, apiKey) => {
    try {
      const result = await hostApiFetch<{ success: boolean; error?: string }>(`/api/provider-accounts/${encodeURIComponent(accountId)}`, {
        method: 'PUT',
        body: JSON.stringify({ updates, apiKey }),
      });

      if (!result.success) {
        throw new Error(result.error || 'Failed to update provider account');
      }

      await get().refreshProviderSnapshot();
    } catch (error) {
      console.error('Failed to update account:', error);
      throw error;
    }
  },
  
  deleteProvider: async (providerId) => {
    try {
      const result = await hostApiFetch<{ success: boolean; error?: string }>(`/api/providers/${encodeURIComponent(providerId)}`, {
        method: 'DELETE',
      });
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to delete provider');
      }
      
      // 刷新列表
      await get().refreshProviderSnapshot();
    } catch (error) {
      console.error('Failed to delete provider:', error);
      throw error;
    }
  },

  removeAccount: async (accountId) => {
    try {
      const result = await hostApiFetch<{ success: boolean; error?: string }>(`/api/provider-accounts/${encodeURIComponent(accountId)}`, {
        method: 'DELETE',
      });

      if (!result.success) {
        throw new Error(result.error || 'Failed to delete provider account');
      }

      await get().refreshProviderSnapshot();
    } catch (error) {
      console.error('Failed to delete account:', error);
      throw error;
    }
  },

  deleteAccount: async (accountId) => get().removeAccount(accountId),
  
  setApiKey: async (providerId, apiKey) => {
    try {
      const result = await hostApiFetch<{ success: boolean; error?: string }>(`/api/providers/${encodeURIComponent(providerId)}`, {
        method: 'PUT',
        body: JSON.stringify({ updates: {}, apiKey }),
      });
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to set API key');
      }
      
      // 刷新列表
      await get().refreshProviderSnapshot();
    } catch (error) {
      console.error('Failed to set API key:', error);
      throw error;
    }
  },

  updateProviderWithKey: async (providerId, updates, apiKey) => {
    try {
      const result = await hostApiFetch<{ success: boolean; error?: string }>(`/api/providers/${encodeURIComponent(providerId)}`, {
        method: 'PUT',
        body: JSON.stringify({ updates, apiKey }),
      });

      if (!result.success) {
        throw new Error(result.error || 'Failed to update provider');
      }

      await get().refreshProviderSnapshot();
    } catch (error) {
      console.error('Failed to update provider with key:', error);
      throw error;
    }
  },
  
  deleteApiKey: async (providerId) => {
    try {
      const result = await hostApiFetch<{ success: boolean; error?: string }>(
        `/api/providers/${encodeURIComponent(providerId)}?apiKeyOnly=1`,
        { method: 'DELETE' },
      );
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to delete API key');
      }
      
      // 刷新列表
      await get().refreshProviderSnapshot();
    } catch (error) {
      console.error('Failed to delete API key:', error);
      throw error;
    }
  },
  
  setDefaultProvider: async (providerId) => {
    try {
      const result = await hostApiFetch<{ success: boolean; error?: string }>('/api/providers/default', {
        method: 'PUT',
        body: JSON.stringify({ providerId }),
      });
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to set default provider');
      }
      
      set({ defaultAccountId: providerId });
    } catch (error) {
      console.error('Failed to set default provider:', error);
      throw error;
    }
  },

  setDefaultAccount: async (accountId) => {
    try {
      const result = await hostApiFetch<{ success: boolean; error?: string }>('/api/provider-accounts/default', {
        method: 'PUT',
        body: JSON.stringify({ accountId }),
      });

      if (!result.success) {
        throw new Error(result.error || 'Failed to set default provider account');
      }

      set({ defaultAccountId: accountId });
    } catch (error) {
      console.error('Failed to set default account:', error);
      throw error;
    }
  },
  
  validateAccountApiKey: async (providerId, apiKey, options) => {
    try {
      const result = await hostApiFetch<{ valid: boolean; error?: string }>('/api/providers/validate', {
        method: 'POST',
        body: JSON.stringify({ providerId, apiKey, options }),
      });
      return result;
    } catch (error) {
      return { valid: false, error: String(error) };
    }
  },

  validateApiKey: async (providerId, apiKey, options) => get().validateAccountApiKey(providerId, apiKey, options),
  
  getAccountApiKey: async (providerId) => {
    try {
      const result = await hostApiFetch<{ apiKey: string | null }>(`/api/providers/${encodeURIComponent(providerId)}/api-key`);
      return result.apiKey;
    } catch {
      return null;
    }
  },

  getApiKey: async (providerId) => get().getAccountApiKey(providerId),

  getEnabledProviderModels: () => {
    const { accounts, statuses, vendors } = get();
    // TODO(chat-model-switch): Chat 输入框模型切换应直接读取此接口。
    return buildEnabledProviderModels(accounts, statuses, vendors);
  },

  getCurrentEffectiveProviderModel: () => {
    const { accounts, statuses, vendors, defaultAccountId } = get();
    // Chat 在新建会话/恢复会话时应使用此接口解析当前生效模型。
    return resolveCurrentEffectiveProviderModel(accounts, statuses, vendors, defaultAccountId);
  },

  switchCurrentProviderModel: async (accountId) => {
    const { accounts, statuses, vendors } = get();
    const enabledModels = buildEnabledProviderModels(accounts, statuses, vendors);
    if (!enabledModels.some((model) => model.accountId === accountId)) {
      throw new Error('Target model is not enabled');
    }
    // 模型切换通过“切换默认 provider 账号”来实现。
    await get().setDefaultAccount(accountId);
  },

  ensureManagedGoogleProxyAccount: async (apiKey) => {
    const baseUrl = resolveBusinessApiBaseUrl();
    if (!baseUrl) {
      throw new Error('VITE_BUSINESS_API_BASE_URL is not configured');
    }

    const modelsResponse = await getModels();
    const availableModelIds = new Set(
      (modelsResponse?.data ?? [])
        .map((model) => model.id.trim())
        .filter((id) => id.length > 0)
    );
    const syncedPresets = MANAGED_GOOGLE_PRESET_ACCOUNTS.filter((preset) =>
      availableModelIds.has(preset.model)
    );

    const now = new Date().toISOString();
    const accounts = await hostApiFetch<ProviderAccount[]>('/api/provider-accounts');
    const upsertPreset = async (preset: ManagedGooglePresetAccount): Promise<void> => {
      const existing = accounts.find((account) => account.id === preset.id);
      const payload: ProviderAccount = {
        id: preset.id,
        vendorId: 'google',
        label: preset.label,
        authMode: 'api_key',
        baseUrl,
        apiProtocol: MANAGED_GOOGLE_PROTOCOL,
        model: preset.model,
        enabled: true,
        isDefault: false,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };

      if (existing) {
        const updateResult = await hostApiFetch<{ success: boolean; error?: string }>(
          `/api/provider-accounts/${encodeURIComponent(preset.id)}`,
          {
            method: 'PUT',
            body: JSON.stringify({
              updates: {
                label: payload.label,
                authMode: payload.authMode,
                baseUrl: payload.baseUrl,
                apiProtocol: payload.apiProtocol,
                model: payload.model,
                enabled: payload.enabled,
              },
              apiKey,
            }),
          }
        );
        if (!updateResult.success) {
          throw new Error(updateResult.error || `Failed to update managed Google provider ${preset.id}`);
        }
      } else {
        const createResult = await hostApiFetch<{ success: boolean; error?: string }>('/api/provider-accounts', {
          method: 'POST',
          body: JSON.stringify({ account: payload, apiKey }),
        });
        if (!createResult.success) {
          throw new Error(createResult.error || `Failed to create managed Google provider ${preset.id}`);
        }
      }
    };

    for (const preset of syncedPresets) {
      await upsertPreset(preset);
    }

    const LEGACY_MANAGED_GOOGLE_IDS = new Set(['google:managed-business']);
    const staleLegacyAccounts = accounts.filter((account) => LEGACY_MANAGED_GOOGLE_IDS.has(account.id));
    for (const stale of staleLegacyAccounts) {
      await hostApiFetch<{ success: boolean }>(`/api/provider-accounts/${encodeURIComponent(stale.id)}`, {
        method: 'DELETE',
      });
    }

    const currentPresetIds = new Set(syncedPresets.map((p) => p.id));
    const staleManagedAccounts = accounts.filter(
      (account) => account.vendorId === 'google'
        && account.id.endsWith(':managed-google')
        && !currentPresetIds.has(account.id)
    );
    for (const stale of staleManagedAccounts) {
      await hostApiFetch<{ success: boolean }>(`/api/provider-accounts/${encodeURIComponent(stale.id)}`, {
        method: 'DELETE',
      });
    }

    await get().refreshProviderSnapshot();
  },

  ensureBaowenmaoPresetAccounts: async (apiKey) => {
    const baseUrl = resolveBusinessApiBaseUrl();
    if (!baseUrl) {
      throw new Error('VITE_BUSINESS_API_BASE_URL is not configured');
    }

    const modelsResponse = await getModels();
    const availableModelIds = new Set(
      (modelsResponse?.data ?? [])
        .map((model) => model.id.trim())
        .filter((id) => id.length > 0)
    );
    console.log('availableModelIds', availableModelIds);
    const syncedPresets = BAOWENMAO_PRESET_ACCOUNTS.filter((preset) => availableModelIds.has(preset.model));
    console.log('syncedPresets', syncedPresets);

    const now = new Date().toISOString();
    const accounts = await hostApiFetch<ProviderAccount[]>('/api/provider-accounts');

    const upsertPreset = async (preset: BaowenmaoPresetAccount): Promise<void> => {
      const existing = accounts.find((account) => account.id === preset.id);
      const payload: ProviderAccount = {
        id: preset.id,
        vendorId: 'baowenmao',
        label: preset.label,
        authMode: 'api_key',
        baseUrl,
        apiProtocol: BAOWENMAO_PROTOCOL,
        model: preset.model,
        enabled: true,
        isDefault: false,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };

      if (existing) {
        const updateResult = await hostApiFetch<{ success: boolean; error?: string }>(
          `/api/provider-accounts/${encodeURIComponent(preset.id)}`,
          {
            method: 'PUT',
            body: JSON.stringify({
              updates: {
                label: payload.label,
                authMode: payload.authMode,
                baseUrl: payload.baseUrl,
                apiProtocol: payload.apiProtocol,
                model: payload.model,
                enabled: payload.enabled,
              },
              apiKey,
            }),
          }
        );
        if (!updateResult.success) {
          throw new Error(updateResult.error || `Failed to update Baowenmao provider ${preset.id}`);
        }
      } else {
        const createResult = await hostApiFetch<{ success: boolean; error?: string }>('/api/provider-accounts', {
          method: 'POST',
          body: JSON.stringify({ account: payload, apiKey }),
        });
        if (!createResult.success) {
          throw new Error(createResult.error || `Failed to create Baowenmao provider ${preset.id}`);
        }
      }
    };

    for (const preset of syncedPresets) {
      await upsertPreset(preset);
    }

    // 清理不再属于后端模型列表的旧 baowenmao 账号
    const currentPresetIds = new Set(syncedPresets.map((p) => p.id));
    const staleAccounts = accounts.filter(
      (account) => account.vendorId === 'baowenmao' && !currentPresetIds.has(account.id)
    );
    for (const stale of staleAccounts) {
      await hostApiFetch<{ success: boolean }>(`/api/provider-accounts/${encodeURIComponent(stale.id)}`, {
        method: 'DELETE',
      });
    }

    const defaultPreset = syncedPresets.find((preset) => preset.isDefault) ?? syncedPresets[0];
    if (defaultPreset) {
      const defaultResult = await hostApiFetch<{ success: boolean; error?: string }>(
        '/api/provider-accounts/default',
        {
          method: 'PUT',
          body: JSON.stringify({ accountId: defaultPreset.id }),
        }
      );
      if (!defaultResult.success) {
        throw new Error(defaultResult.error || 'Failed to set default Baowenmao provider');
      }
    }

    await get().refreshProviderSnapshot();
  },
}));
