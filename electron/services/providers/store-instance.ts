// Lazy-load electron-store (ESM module) from the main process only.
import { access, unlink } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import path from 'path';

type ProviderStoreLike = {
  get: (key: string) => unknown;
  set: (key: string, value: unknown) => void;
  path?: string;
};

let providerStore: ProviderStoreLike | null = null;
let legacyProviderStore: ProviderStoreLike | null = null;

const PROVIDER_STORE_DEFAULTS = {
  schemaVersion: 0,
  providers: {} as Record<string, unknown>,
  providerAccounts: {} as Record<string, unknown>,
  apiKeys: {} as Record<string, string>,
  providerSecrets: {} as Record<string, unknown>,
  defaultProvider: null as string | null,
  defaultProviderAccountId: null as string | null,
};

async function createStore(name: string) {
  const Store = (await import('electron-store')).default;
  return new Store({
    name,
    defaults: PROVIDER_STORE_DEFAULTS,
  }) as ProviderStoreLike;
}

async function removeLegacyProviderStoreFileIfExists() {
  const basePath = providerStore?.path ?? legacyProviderStore?.path;
  if (!basePath) return;
  const legacyPath = path.join(path.dirname(basePath), 'clawx-providers.json');
  try {
    await access(legacyPath, fsConstants.F_OK);
    await unlink(legacyPath);
  } catch {
    // Ignore cleanup failures; store migration/read path remains functional.
  }
}

async function migrateLegacyProviderStoreIfNeeded() {
  if (!providerStore) return;

  const hasModernData =
    Number(providerStore.get('schemaVersion') ?? 0) > 0
    || Object.keys((providerStore.get('providerAccounts') ?? {}) as Record<string, unknown>).length > 0
    || Object.keys((providerStore.get('providers') ?? {}) as Record<string, unknown>).length > 0;
  if (hasModernData) {
    await removeLegacyProviderStoreFileIfExists();
    return;
  }

  if (!legacyProviderStore) {
    legacyProviderStore = await createStore('clawx-providers');
  }

  const hasLegacyData =
    Number(legacyProviderStore.get('schemaVersion') ?? 0) > 0
    || Object.keys((legacyProviderStore.get('providerAccounts') ?? {}) as Record<string, unknown>).length > 0
    || Object.keys((legacyProviderStore.get('providers') ?? {}) as Record<string, unknown>).length > 0;
  if (!hasLegacyData) {
    await removeLegacyProviderStoreFileIfExists();
    return;
  }

  for (const key of Object.keys(PROVIDER_STORE_DEFAULTS)) {
    const value = legacyProviderStore.get(key);
    if (value !== undefined) {
      providerStore.set(key, value);
    }
  }

  // Migration succeeded; remove legacy clawx-providers.json safely.
  await removeLegacyProviderStoreFileIfExists();
}

export async function getClawXProviderStore() {
  if (!providerStore) {
    providerStore = await createStore('storyclaw-providers');
    await migrateLegacyProviderStoreIfNeeded();
  }

  return providerStore;
}
