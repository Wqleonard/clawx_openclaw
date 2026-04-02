/**
 * BoomClaw Web Search + Web Fetch Plugin
 *
 * Registers `web_search` and `web_fetch` tools that proxy through BoomClaw's
 * host API (localhost:3210), bypassing OpenClaw's SSRF restrictions.
 *
 * Requires in openclaw.json:
 *   tools.web.search.enabled: false  → prevents core web_search from being created
 *   tools.web.fetch.enabled:  false  → prevents core web_fetch from being created
 *   plugins.entries["boom-search"].enabled: true → activates this plugin
 *
 * This file is deployed to ~/.openclaw/extensions/boom-search/ at startup.
 */

const BOOM_SEARCH_HOST_API = "http://localhost:3210";

const plugin = {
  id: "boom-search",
  name: "BoomClaw Web Search",
  description: "BoomClaw built-in web search and fetch plugin",

  register(api) {
    // ── web_search ────────────────────────────────────────────────
    api.registerTool({
      name: "web_search",
      label: "Web Search",
      description:
        "Search the web for current information, news, and recent events. " +
        "Returns a list of relevant results with titles, URLs, and descriptions.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The search query string.",
          },
          count: {
            type: "number",
            description: "Number of results to return (1-10). Default: 5.",
          },
        },
        required: ["query"],
        additionalProperties: false,
      },

      async execute(_toolCallId, args) {
        const query = String(args.query ?? "").trim();
        const count = Math.min(10, Math.max(1, Number(args.count ?? 5)));

        try {
          const url = new URL(`${BOOM_SEARCH_HOST_API}/api/boom-search`);
          url.searchParams.set("q", query);
          url.searchParams.set("count", String(count));

          const res = await fetch(url.toString(), {
            signal: AbortSignal.timeout(15000),
          });

          if (!res.ok) {
            throw new Error(`Search API returned ${res.status}`);
          }

          const data = await res.json();
          return jsonResult(data);
        } catch (err) {
          return jsonResult({
            error: "search_failed",
            message: String(err?.message ?? err),
            query,
          });
        }
      },
    });

    // ── web_fetch ─────────────────────────────────────────────────
    api.registerTool({
      name: "web_fetch",
      label: "Web Fetch",
      description:
        "Fetch the content of a URL and return it as readable text or markdown. " +
        "Use this to read web pages, articles, or documentation.",
      parameters: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "The URL to fetch (http/https only).",
          },
          extractMode: {
            type: "string",
            enum: ["markdown", "text"],
            description: "Content extraction mode. Default: markdown.",
          },
          maxChars: {
            type: "number",
            description: "Maximum characters to return. Default: 50000.",
          },
        },
        required: ["url"],
        additionalProperties: false,
      },

      async execute(_toolCallId, args) {
        const targetUrl = String(args.url ?? "").trim();

        try {
          const url = new URL(`${BOOM_SEARCH_HOST_API}/api/boom-fetch`);
          url.searchParams.set("url", targetUrl);
          if (args.extractMode) url.searchParams.set("mode", String(args.extractMode));
          if (args.maxChars) url.searchParams.set("maxChars", String(args.maxChars));

          const res = await fetch(url.toString(), {
            signal: AbortSignal.timeout(30000),
          });

          if (!res.ok) {
            throw new Error(`Fetch API returned ${res.status}`);
          }

          const data = await res.json();
          return jsonResult(data);
        } catch (err) {
          return jsonResult({
            error: "fetch_failed",
            message: String(err?.message ?? err),
            url: targetUrl,
          });
        }
      },
    });
  },
};

function jsonResult(payload) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(payload, null, 2),
      },
    ],
    details: payload,
  };
}

export default plugin;
