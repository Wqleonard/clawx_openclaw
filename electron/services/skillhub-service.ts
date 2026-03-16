import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const SEARCH_URL = 'http://lb-3zbg86f6-0gwe3n7q8t4sv2za.clb.gz-tencentclb.com/api/v1/search';
const PRIMARY_DOWNLOAD_URL =
  'http://lb-3zbg86f6-0gwe3n7q8t4sv2za.clb.gz-tencentclb.com/api/v1/download?slug={slug}';
const FALLBACK_DOWNLOAD_URL =
  'https://skillhub-1388575217.cos.ap-guangzhou.myqcloud.com/skills/{slug}.zip';

// 复用 demo/skillhub 里的本地索引路径，便于离线搜索对齐 Python 版本
const LOCAL_INDEX_PATH = join(__dirname, '../demo/skillhub/skills_index.local.json');

const USER_AGENT = 'skillhub-inkmind-client/1.0';

export interface SkillHubSearchResult {
  slug: string;
  name: string;
  description: string;
  version: string;
}

export interface SkillHubFetchedSkill {
  slug: string;
  name: string;
  version: string;
  files: Record<string, string | Buffer>;
}

async function httpGetJson(url: string, timeoutMs = 10_000): Promise<unknown | null> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/json',
      },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(id);
  }
}

async function httpGetBytes(url: string, timeoutMs = 30_000): Promise<Buffer> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/zip,application/octet-stream,*/*',
      },
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} for ${url}`);
    }
    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch (err: unknown) {
    const error = err as { message?: string };
    throw new Error(`Failed GET ${url}: ${error?.message ?? String(err)}`);
  } finally {
    clearTimeout(id);
  }
}

async function localSearch(query: string, limit: number): Promise<SkillHubSearchResult[]> {
  if (!existsSync(LOCAL_INDEX_PATH)) return [];
  try {
    const raw = await readFile(LOCAL_INDEX_PATH, 'utf8');
    const data = JSON.parse(raw);
    const skills = Array.isArray(data) ? data : data.skills;
    if (!Array.isArray(skills)) return [];

    const q = query.toLowerCase().trim();

    const getText = (s: any): string => {
      const tags = Array.isArray(s?.tags) ? s.tags.join(' ') : '';
      return [
        String(s?.slug ?? ''),
        String(s?.name ?? ''),
        String(s?.description ?? ''),
        String(s?.summary ?? ''),
        tags,
      ]
        .join(' ')
        .toLowerCase();
    };

    const matches = skills.filter((s: any) => typeof s === 'object' && s && getText(s).includes(q));

    matches.sort((a: any, b: any) => {
      const ta = getText(a);
      const tb = getText(b);
      const ca = ta.split(q).length - 1;
      const cb = tb.split(q).length - 1;
      return cb - ca;
    });

    return matches.slice(0, limit).map((s: any) => ({
      slug: String(s?.slug ?? ''),
      name: String(s?.name ?? s?.slug ?? ''),
      description: String(s?.description ?? s?.summary ?? ''),
      version: String(s?.version ?? ''),
    }));
  } catch {
    return [];
  }
}

export class SkillHubService {
  async searchSkills(params: {
    query: string;
    limit?: number;
    offline?: boolean;
  }): Promise<SkillHubSearchResult[]> {
    console.log('[SkillHubService] searchSkills params:', params);
    const { query, limit = 20, offline = false } = params;
    if (!offline) {
      const searchParams = new URLSearchParams({
        q: query.trim(),
        limit: String(Math.max(1, limit)),
      });
      const raw = await httpGetJson(`${SEARCH_URL}?${searchParams.toString()}`);
      if (raw && typeof raw === 'object' && Array.isArray((raw as any).results)) {
        const results: SkillHubSearchResult[] = [];
        for (const item of (raw as any).results) {
          if (!item || typeof item !== 'object') continue;
          const slug = String((item as any).slug ?? '').trim();
          if (!slug) continue;
          results.push({
            slug,
            name: String(
              (item as any).displayName ??
                (item as any).name ??
                slug,
            ),
            description: String(
              (item as any).summary ??
                (item as any).description ??
                '',
            ),
            version: String((item as any).version ?? ''),
          });
        }
        return results;
      }
    }
    return localSearch(query, limit);
  }

  async fetchSkill(params: {
    slug: string;
    timeoutMs?: number;
    retries?: number;
  }): Promise<SkillHubFetchedSkill> {
    const { slug, timeoutMs = 30_000, retries = 2 } = params;
    const encodedSlug = encodeURIComponent(slug);
    const candidates = [
      PRIMARY_DOWNLOAD_URL.replace('{slug}', encodedSlug),
      FALLBACK_DOWNLOAD_URL.replace('{slug}', encodedSlug),
    ];

    let lastErr = '';
    let zipBytes: Buffer | null = null;

    for (const url of candidates) {
      for (let attempt = 0; attempt <= retries; attempt += 1) {
        try {
          const raw = await httpGetBytes(url, timeoutMs);
          // zip 文件固定以 PK\x03\x04 开头
          if (!raw.subarray(0, 4).equals(Buffer.from('504b0304', 'hex'))) {
            throw new Error('响应不是合法 zip（非 PK 魔数）');
          }
          zipBytes = raw;
          break;
        } catch (err: unknown) {
          const error = err as { message?: string };
          lastErr = error?.message ?? String(err);
          if (attempt < retries) {
            await new Promise((resolve) => {
              setTimeout(resolve, 500 * (attempt + 1));
            });
          }
        }
      }
      if (zipBytes) break;
    }

    if (!zipBytes) {
      throw new Error(`Failed to download skill "${slug}": ${lastErr}`);
    }

    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(zipBytes);
    const files: Record<string, string | Buffer> = {};

    await Promise.all(
      Object.values(zip.files).map(async (entry) => {
        if (entry.dir) return;
        const path = entry.name;
        const buf = await entry.async('nodebuffer');
        try {
          files[path] = buf.toString('utf8');
        } catch {
          files[path] = buf;
        }
      }),
    );

    let name = slug;
    let version = '';
    const configRaw = (files['config.json'] ??
      files[`${slug}/config.json`]) as string | Buffer | undefined;
    if (typeof configRaw === 'string') {
      try {
        const cfg = JSON.parse(configRaw);
        name = String(cfg.name ?? slug);
        version = String(cfg.version ?? '');
      } catch {
        // ignore JSON parse errors
      }
    }

    return {
      slug,
      name,
      version,
      files,
    };
  }
}

