import type { IncomingMessage, ServerResponse } from 'http';
import type { HostApiContext } from '../context';
import { parseJsonBody, sendJson } from '../route-utils';

export async function handleSkillHubRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ctx: HostApiContext,
): Promise<boolean> {
  if (url.pathname === '/api/skillhub/search' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{
        query: string;
        limit?: number;
        offline?: boolean;
      }>(req);
      const results = await ctx.skillHubService.searchSkills(body);
      sendJson(res, 200, { success: true, results });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/skillhub/fetch' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ slug: string }>(req);
      const skill = await ctx.skillHubService.fetchSkill({ slug: body.slug });
      sendJson(res, 200, { success: true, skill });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  return false;
}

