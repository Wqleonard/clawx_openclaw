/**
 * Chat Toolbar
 * Session selector, new session, refresh, and thinking toggle.
 * Rendered in the Header when on the Chat page.
 */
import { Brain, History, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useChatStore } from '@/stores/chat';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';

type ToolbarSession = {
  key: string;
  displayName?: string;
  label?: string;
};

type ToolbarSessionBucket = {
  key: string;
  label: string;
  sessions: ToolbarSession[];
};

type ChatToolbarProps = {
  sessionBuckets: ToolbarSessionBucket[];
  currentSessionKey: string;
  agentNameById: Record<string, string>;
  getAgentIdFromSessionKey: (sessionKey: string) => string;
  getSessionLabel: (key: string, displayName?: string, label?: string) => string;
  onCreateSession: () => void;
  onSelectSession: (sessionKey: string) => void;
  onDeleteSession: (session: { key: string; label: string }) => void;
};

export function ChatToolbar({
  sessionBuckets,
  currentSessionKey,
  agentNameById,
  getAgentIdFromSessionKey,
  getSessionLabel,
  onCreateSession,
  onSelectSession,
  onDeleteSession,
}: ChatToolbarProps) {
  const refresh = useChatStore((s) => s.refresh);
  const loading = useChatStore((s) => s.loading);
  const showThinking = useChatStore((s) => s.showThinking);
  const toggleThinking = useChatStore((s) => s.toggleThinking);
  const { t, i18n } = useTranslation(['chat', 'common']);
  const isZh = i18n.language?.startsWith('zh');

  return (
    <div className="flex items-center gap-2">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onCreateSession}>
            <Plus className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>{t('common:sidebar.newChat')}</p>
        </TooltipContent>
      </Tooltip>

      <Popover>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <History className="h-4 w-4" />
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent>
            <p>{isZh ? '历史记录' : 'History'}</p>
          </TooltipContent>
        </Tooltip>
        <PopoverContent align="start" className="w-80 p-2">
          <div className="max-h-[420px] overflow-y-auto space-y-2">
            {sessionBuckets.some((bucket) => bucket.sessions.length > 0) ? (
              sessionBuckets.map((bucket) =>
                bucket.sessions.length > 0 ? (
                  <div key={bucket.key} className="pt-1">
                    <div className="px-2 pb-1 text-[11px] font-medium text-muted-foreground/60 tracking-tight">
                      {bucket.label}
                    </div>
                    {bucket.sessions.map((session) => {
                      const agentId = getAgentIdFromSessionKey(session.key);
                      const agentName = agentNameById[agentId] || agentId;
                      const sessionLabel = getSessionLabel(
                        session.key,
                        session.displayName,
                        session.label
                      );
                      return (
                        <div key={session.key} className="group relative flex items-center">
                          <button
                            onClick={() => onSelectSession(session.key)}
                            className={cn(
                              'w-full text-left rounded-lg px-2.5 py-1.5 text-[13px] transition-colors pr-7',
                              'hover:bg-black/5 dark:hover:bg-white/5',
                              currentSessionKey === session.key
                                ? 'bg-black/5 dark:bg-white/10 text-foreground font-medium'
                                : 'text-foreground/75'
                            )}
                          >
                            <div className="flex min-w-0 items-center gap-2">
                              <span className="shrink-0 rounded-full bg-black/[0.04] px-2 py-0.5 text-[10px] font-medium text-foreground/70 dark:bg-white/[0.08]">
                                {agentName}
                              </span>
                              <span className="truncate">{sessionLabel}</span>
                            </div>
                          </button>
                          <button
                            aria-label="Delete session"
                            onClick={(event) => {
                              event.stopPropagation();
                              onDeleteSession({ key: session.key, label: sessionLabel });
                            }}
                            className={cn(
                              'absolute right-1 flex items-center justify-center rounded p-0.5 transition-opacity',
                              'opacity-0 group-hover:opacity-100',
                              'text-muted-foreground hover:text-destructive hover:bg-destructive/10'
                            )}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                ) : null
              )
            ) : (
              <div className="px-2 py-4 text-center text-xs text-muted-foreground">{t('noLogs')}</div>
            )}
          </div>
        </PopoverContent>
      </Popover>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => refresh()}
            disabled={loading}
          >
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>{t('toolbar.refresh')}</p>
        </TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              'h-8 w-8',
              showThinking && 'bg-primary/10 text-primary',
            )}
            onClick={toggleThinking}
          >
            <Brain className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>{showThinking ? t('toolbar.hideThinking') : t('toolbar.showThinking')}</p>
        </TooltipContent>
      </Tooltip>
    </div>
  );
}
