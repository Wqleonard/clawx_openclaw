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
import { logger } from '../../utils/logger';

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

const SEARCH_MODEL = 'doubao-seed-1.6-flash';

const SEARCH_ACCOUNT_ID = 'ark:custom-baowenmao';

const SEARCH_SYSTEM_PROMPT =
  '你是一个专业的网络搜索助手。请使用搜索工具收集相关信息，给出简洁准确的综合摘要，并在回答末尾用 [标题](URL) 格式标注所有参考来源。用中文回答。';

// Responses API web_search tool — 火山方舟格式
const SEARCH_TOOLS = [{ type: 'web_search', limit: 5 }];

// ── Credential helper ──────────────────────────────────────────────────────

interface Credentials {
  token: string;
  baseUrl: string;
}

async function getCredentials(): Promise<Credentials | null> {
  const store = await getClawXProviderStore();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const accounts = (store.get('providerAccounts') ?? {}) as Record<string, any>;
  const defaultAccountId = store.get('defaultProviderAccountId') as string | undefined;
  const accountIds = Object.keys(accounts);
  const candidateIds = [
    ...(defaultAccountId ? [defaultAccountId] : []),
    ...accountIds.filter((id) => id.endsWith(':custom-baowenmao')),
    SEARCH_ACCOUNT_ID,
  ].filter((id, index, arr) => arr.indexOf(id) === index);

  for (const accountId of candidateIds) {
    const secret = await getProviderSecret(accountId);
    const token =
      secret?.type === 'api_key'
        ? secret.apiKey
        : secret?.type === 'local'
          ? (secret.apiKey ?? null)
          : null;
    const baseUrl = accounts[accountId]?.baseUrl as string | undefined;

    if (token && baseUrl) {
      return { token, baseUrl };
    }
  }

  return null;
}

// ── Responses API response parser ─────────────────────────────────────────

interface ResponsesApiAnnotation {
  type: string;
  url?: string;
  title?: string;
}

interface ResponsesApiContentBlock {
  type: string;
  text?: string;
  annotations?: ResponsesApiAnnotation[];
}

interface ResponsesApiOutputItem {
  type: string;
  role?: string;
  content?: ResponsesApiContentBlock[];
}

interface ResponsesApiResponse {
  output?: ResponsesApiOutputItem[];
}

interface ParsedResponsesResult {
  text: string;
  citations: Array<{ title: string; url: string }>;
}

function parseResponsesOutput(data: ResponsesApiResponse): ParsedResponsesResult {
  let text = '';
  const citations: Array<{ title: string; url: string }> = [];

  for (const item of data.output ?? []) {
    if (item.type === 'message' && item.content) {
      for (const block of item.content) {
        if (block.type === 'output_text' && block.text) {
          text += block.text;
          for (const ann of block.annotations ?? []) {
            if (ann.type === 'url_citation' && ann.url) {
              citations.push({ title: ann.title ?? ann.url, url: ann.url });
            }
          }
        }
      }
    }
  }

  return { text, citations };
}

// ── Web search implementation (Responses API) ─────────────────────────────

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

  // 业务网关代理到 /api/v3/responses
  const responsesUrl = `${baseUrl}/responses`;
  const reqBody = {
    model: SEARCH_MODEL,
    stream: false,
    tools: SEARCH_TOOLS,
    extra_body: {"thinking": {"type": "disabled"}},
    // thinking: {type: "disabled"},
    input: [
      {
        role: 'system',
        content: [{ type: 'input_text', text: SEARCH_SYSTEM_PROMPT }],
      },
      {
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: `请帮我搜索并总结以下内容，并标注出重要信息URL地址：${query}`,
          },
        ],
      },
    ],
  };

  const response = await fetch(responsesUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(reqBody),
    signal: AbortSignal.timeout(60_000),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    logger.error('[boom-search] backend error', response.status, errText);
    throw new Error(`Search API ${response.status}: ${errText}`);
  }

  const data = (await response.json()) as ResponsesApiResponse;
  const { text, citations } = parseResponsesOutput(data);

  return {
    query,
    results: [
      { title: `关于「${query}」的搜索摘要`, url: '', description: text },
      ...citations.map((c) => ({ title: c.title, url: c.url, description: c.url })),
    ],
  };
}

async function performFetch(
  targetUrl: string,
  mode: string,
  maxChars: number,
): Promise<FetchResponse> {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(targetUrl);
  } catch {
    throw new Error('Invalid URL');
  }

  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw new Error('Only http/https URLs are supported');
  }

  const response = await fetch(parsedUrl.toString(), {
    method: 'GET',
    headers: {
      'User-Agent': 'StoryClaw-BoomFetch/1.0 (+https://storyclaw.ai)',
      Accept: 'text/html,application/xhtml+xml,text/plain,application/json;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    throw new Error(`Fetch URL failed with status ${response.status}`);
  }

  const contentType = (response.headers.get('content-type') ?? '').toLowerCase();
  const contentDisposition = (response.headers.get('content-disposition') ?? '').toLowerCase();
  const rawBytes = new Uint8Array(await response.arrayBuffer());
  const rawText = decodeFetchBodyAsText(rawBytes, parsedUrl, contentType, contentDisposition);
  const normalizedText = normalizeFetchedContent(rawText, contentType);
  const extracted = normalizedText.slice(0, maxChars) || '（未能提取到网页内容）';

  if (mode === 'text') {
    return {
      url: parsedUrl.toString(),
      content: extracted,
      extractMode: mode,
    };
  }

  return {
    url: parsedUrl.toString(),
    content: `来源: ${parsedUrl.toString()}\n\n${extracted}`,
    extractMode: mode,
  };
}

function decodeFetchBodyAsText(
  bytes: Uint8Array,
  sourceUrl: URL,
  contentType: string,
  contentDisposition: string,
): string {
  const pathname = sourceUrl.pathname.toLowerCase();
  const isLikelyTextByExt = [
    '.md',
    '.markdown',
    '.txt',
    '.json',
    '.yaml',
    '.yml',
    '.csv',
    '.xml',
    '.html',
    '.htm',
  ].some((ext) => pathname.endsWith(ext));

  const isLikelyTextByType =
    contentType.startsWith('text/')
    || contentType.includes('json')
    || contentType.includes('xml')
    || contentType.includes('yaml')
    || contentType.includes('javascript')
    || contentType.includes('markdown');

  const isAttachment = contentDisposition.includes('attachment');
  const maybeText = isLikelyTextByType || isLikelyTextByExt || isAttachment;

  if (!maybeText) {
    // Non-text/binary payloads are not rendered as attachments by this tool.
    return '（该链接返回的是二进制文件，当前 web_fetch 仅支持文本类内容展示）';
  }

  try {
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  } catch {
    return '（文件内容解码失败，可能不是 UTF-8 文本）';
  }
}

function normalizeFetchedContent(raw: string, contentType: string): string {
  const isHtml = contentType.includes('text/html') || /<html[\s>]|<body[\s>]|<!doctype html/i.test(raw);
  const base = isHtml ? htmlToReadableText(raw) : raw;
  return decodeHtmlEntities(base)
    .replace(/\r\n/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function htmlToReadableText(html: string): string {
  let output = html;
  output = output.replace(/<!--[\s\S]*?-->/g, ' ');
  output = output.replace(/<(script|style|noscript|svg|canvas|template)[^>]*>[\s\S]*?<\/\1>/gi, ' ');
  output = output.replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)\s*\/?>/gi, '\n');
  output = output.replace(/<(p|div|li|h[1-6]|tr|section|article|main|header|footer|aside|ul|ol|table)[^>]*>/gi, '\n');
  output = output.replace(/<[^>]+>/g, ' ');
  return output;
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, '\'')
    .replace(/&#x27;/gi, '\'')
    .replace(/&#x2F;/gi, '/')
    .replace(/&#(\d+);/g, (full, dec: string) => {
      const code = Number.parseInt(dec, 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : full;
    })
    .replace(/&#x([0-9a-fA-F]+);/g, (full, hex: string) => {
      const code = Number.parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : full;
    });
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
      logger.error('[boom-search] performSearch threw:', msg);
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
