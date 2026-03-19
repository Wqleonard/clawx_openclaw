/**
 * BoomClaw Web Search + Web Fetch API Routes
 *
 * /api/boom-search?q=...&count=...   → called by plugin's web_search tool
 * /api/boom-fetch?url=...&mode=...   → called by plugin's web_fetch tool
 *
 * Both are proxied through BoomClaw's host API so the Gateway process never
 * makes outbound HTTP calls subject to OpenClaw's SSRF restrictions.
 */

import type { IncomingMessage, ServerResponse } from 'http';
import type { HostApiContext } from '../context';
import { setCorsHeaders, sendJson } from '../route-utils';
import { getProviderSecret } from '../../services/secrets/secret-store';
import { getClawXProviderStore } from '../../services/providers/store-instance';

// ── Types ──────────────────────────────────────────────────────────────────

export interface SearchResult {
  title: string;
  url: string;
  description: string;
}

export interface SearchResponse {
  query: string;
  results: SearchResult[];
}

export interface FetchResponse {
  url: string;
  content: string;
  extractMode: string;
}

// ── Constants ──────────────────────────────────────────────────────────────

const SEARCH_MODEL = 'ep-20250911202653-fr9dl';

const SEARCH_ACCOUNT_ID = 'ark:custom-baowenmao';

const SEARCH_SYSTEM_PROMPT =
  '你是一个专业的网络搜索助手。请使用搜索工具收集相关信息，给出简洁准确的综合摘要，并在回答末尾用 [标题](URL) 格式标注所有参考来源。用中文回答。';

const SEARCH_TOOLS = [{"type": "web_search","limit": 5}];

// ── Credential helper ──────────────────────────────────────────────────────

interface Credentials {
  token: string;
  baseUrl: string;
}

async function getCredentials(): Promise<Credentials | null> {
  const secret = await getProviderSecret(SEARCH_ACCOUNT_ID);
  const token =
    secret?.type === 'api_key'
      ? secret.apiKey
      : secret?.type === 'local'
        ? (secret.apiKey ?? null)
        : null;

  if (!token) return null;

  const store = await getClawXProviderStore();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const accounts = (store.get('providerAccounts') ?? {}) as Record<string, any>;
  const baseUrl = accounts[SEARCH_ACCOUNT_ID]?.baseUrl as string | undefined;

  if (!baseUrl) return null;

  return { token, baseUrl };
}

// ── Chat Completions response parser ──────────────────────────────────────

interface ChatCompletionsResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
}

function extractTextFromChatResponse(data: ChatCompletionsResponse): string {
  return data.choices?.[0]?.message?.content?.trim() ?? '';
}

// ── Web search implementation ──────────────────────────────────────────────

async function performSearch(query: string, _count: number): Promise<SearchResponse> {
  const creds = await getCredentials();
  if (!creds) {
    return {
      query,
      results: [
        {
          title: '未登录',
          url: '',
          description: '请先登录爆文猫账号后再使用联网搜索功能',
        },
      ],
    };
  }

  const { token, baseUrl } = creds;

  const chatUrl = `${baseUrl}/chat/completions`;
  console.log('[boom-search] POST', chatUrl, 'model:', SEARCH_MODEL);

  const response = await fetch(chatUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      model: SEARCH_MODEL,
      messages: [
        { role: 'system', content: SEARCH_SYSTEM_PROMPT },
        {
          role: 'user',
          content: `请帮我搜索并总结以下内容，并标注出重要信息URL地址：${query}`,
        },
      ],
      tools: SEARCH_TOOLS,
      stream: false,
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    console.error('[boom-search] backend error', response.status, errText);
    throw new Error(`Search API ${response.status}: ${errText}`);
  }

  const data = (await response.json()) as ChatCompletionsResponse;
  const text = extractTextFromChatResponse(data);

  // 从文本中提取 Markdown 链接 [title](url) 作为引用
  const linkRe = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g;
  const citations: SearchResult[] = [];
  let match: RegExpExecArray | null;
  while ((match = linkRe.exec(text)) !== null) {
    citations.push({ title: match[1], url: match[2], description: match[2] });
  }

  return {
    query,
    results: [
      { title: `关于「${query}」的搜索摘要`, url: '', description: text },
      ...citations,
    ],
  };
}

/**
 * web_fetch is not yet implemented — returns a placeholder.
 */
async function performFetch(
  targetUrl: string,
  _mode: string,
  _maxChars: number,
): Promise<FetchResponse> {
  return {
    url: targetUrl,
    content: `[web_fetch 暂未实现] 目标地址: ${targetUrl}`,
    extractMode: _mode,
  };
}

// ── Route handler ──────────────────────────────────────────────────────────

export async function handleBoomSearchRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  _ctx: HostApiContext,
): Promise<boolean> {
  const { pathname } = url;

  if (pathname !== '/api/boom-search' && pathname !== '/api/boom-fetch') {
    return false;
  }

  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return true;
  }

  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return true;
  }

  // ── /api/boom-search ────────────────────────────────────────────
  if (pathname === '/api/boom-search') {
    const query = url.searchParams.get('q')?.trim() ?? '';
    if (!query) {
      sendJson(res, 400, { error: 'Missing query parameter "q"' });
      return true;
    }
    const count = Math.min(10, Math.max(1, parseInt(url.searchParams.get('count') ?? '5', 10) || 5));
    try {
      sendJson(res, 200, await performSearch(query, count));
    } catch (err) {
      const msg = String(err);
      console.error('[boom-search] performSearch threw:', msg);
      sendJson(res, 500, { error: 'search_failed', message: msg, query });
    }
    return true;
  }

  // ── /api/boom-fetch ─────────────────────────────────────────────
  if (pathname === '/api/boom-fetch') {
    const targetUrl = url.searchParams.get('url')?.trim() ?? '';
    if (!targetUrl) {
      sendJson(res, 400, { error: 'Missing query parameter "url"' });
      return true;
    }
    const mode = url.searchParams.get('mode') ?? 'markdown';
    const maxChars = Math.min(
      200000,
      Math.max(1000, parseInt(url.searchParams.get('maxChars') ?? '50000', 10) || 50000),
    );
    try {
      sendJson(res, 200, await performFetch(targetUrl, mode, maxChars));
    } catch (err) {
      sendJson(res, 500, { error: 'Fetch failed', message: String(err) });
    }
    return true;
  }

  return false;
}
