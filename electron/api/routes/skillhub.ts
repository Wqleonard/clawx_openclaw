import type { IncomingMessage, ServerResponse } from 'http';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import type { HostApiContext } from '../context';
import { getOpenClawSkillsDir } from '../../utils/paths';
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

  if (url.pathname === '/api/skillhub/install' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ slug: string }>(req);
      if (!body.slug?.trim()) {
        sendJson(res, 400, { success: false, error: 'slug is required' });
        return true;
      }
      const skill = await ctx.skillHubService.fetchSkill({ slug: body.slug.trim() });
      const skillsDir = getOpenClawSkillsDir();
      const targetDir = join(skillsDir, skill.slug);
      await mkdir(targetDir, { recursive: true });
      for (const [relPath, content] of Object.entries(skill.files)) {
        const fullPath = join(targetDir, relPath);
        await mkdir(join(targetDir, dirname(relPath)), { recursive: true });
        if (typeof content === 'string') {
          await writeFile(fullPath, content, 'utf8');
        } else {
          await writeFile(fullPath, content);
        }
      }
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  return false;
}

