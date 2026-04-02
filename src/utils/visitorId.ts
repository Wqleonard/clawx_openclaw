const VISITOR_ID_STORAGE_KEY = "bc_visitor_id";
const TWO_YEARS_SECONDS = 60 * 60 * 24 * 365 * 2;

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const key = `${encodeURIComponent(name)}=`;
  const cookies = document.cookie ? document.cookie.split("; ") : [];
  for (const entry of cookies) {
    if (entry.startsWith(key)) {
      const raw = entry.slice(key.length);
      if (!raw) return null;
      try {
        return decodeURIComponent(raw);
      } catch {
        return raw;
      }
    }
  }
  return null;
}

function writeCookie(name: string, value: string) {
  if (typeof document === "undefined") return;
  const secure = typeof location !== "undefined" && location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}; Max-Age=${TWO_YEARS_SECONDS}; Path=/; SameSite=Lax${secure}`;
}

function readStorage(name: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(name);
  } catch {
    return null;
  }
}

function writeStorage(name: string, value: string) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(name, value);
  } catch {
    // Ignore quota/incognito errors and keep cookie only.
  }
}

function generateVisitorId(): string {
  const randomUUID = globalThis.crypto?.randomUUID?.();
  if (randomUUID) return randomUUID;

  if (globalThis.crypto?.getRandomValues) {
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function getOrCreateVisitorId(): string | null {
  if (typeof window === "undefined") return null;

  const fromCookie = readCookie(VISITOR_ID_STORAGE_KEY);
  if (fromCookie) {
    writeStorage(VISITOR_ID_STORAGE_KEY, fromCookie);
    return fromCookie;
  }

  const fromStorage = readStorage(VISITOR_ID_STORAGE_KEY);
  if (fromStorage) {
    writeCookie(VISITOR_ID_STORAGE_KEY, fromStorage);
    return fromStorage;
  }

  const created = generateVisitorId();
  writeCookie(VISITOR_ID_STORAGE_KEY, created);
  writeStorage(VISITOR_ID_STORAGE_KEY, created);
  return created;
}
