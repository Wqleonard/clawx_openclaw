import { useCallback, useEffect, useMemo, useState } from 'react';
import { FolderOpen, RefreshCw, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { invokeIpc } from '@/lib/api-client';
import { useAgentsStore } from '@/stores/agents';
import { cn } from '@/lib/utils';

type CreateSource = 'template' | 'agent';

type CreateAgentOptions = {
  templateId?: string;
  sourceAgentId?: string;
  workspacePath?: string;
};

type AddAgentDialogProps = {
  open: boolean;
  onClose: () => void;
  onCreate: (name: string, options: CreateAgentOptions) => Promise<void>;
  initialWorkspacePath?: string;
  hideWorkspaceSelector?: boolean;
};

const labelClasses = 'text-[14px] text-foreground/80 font-bold';

export function AddAgentDialog({
  open,
  onClose,
  onCreate,
  initialWorkspacePath,
  hideWorkspaceSelector = false,
}: AddAgentDialogProps) {
  const { t } = useTranslation('agents');
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [source, setSource] = useState<CreateSource>('template');
  const { templates, fetchTemplates, agents } = useAgentsStore();
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('default');
  const [selectedAgentId, setSelectedAgentId] = useState<string>('');
  const [workspacePath, setWorkspacePath] = useState<string>(initialWorkspacePath ?? '');

  useEffect(() => {
    if (!open) return;
    void fetchTemplates();
  }, [open, fetchTemplates]);

  const effectiveTemplateId = useMemo(() => {
    if (templates.length === 0) return '';
    if (templates.some((tmpl) => tmpl.id === selectedTemplateId)) return selectedTemplateId;
    return templates[0].id;
  }, [templates, selectedTemplateId]);

  const effectiveAgentId = useMemo(() => {
    if (agents.length === 0) return '';
    if (selectedAgentId && agents.some((agent) => agent.id === selectedAgentId)) return selectedAgentId;
    return agents[0].id;
  }, [agents, selectedAgentId]);

  const handlePickFolder = useCallback(async () => {
    const result = await invokeIpc<{ canceled: boolean; filePaths: string[] }>('dialog:open', {
      properties: ['openDirectory'],
    });
    if (!result.canceled && result.filePaths.length > 0) {
      setWorkspacePath(result.filePaths[0]);
    }
  }, []);

  const handleDialogChange = (nextOpen: boolean) => {
    if (!nextOpen) onClose();
  };

  const handleSubmit = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const options =
        source === 'agent'
          ? {
              sourceAgentId: effectiveAgentId,
              workspacePath: workspacePath || initialWorkspacePath || undefined,
            }
          : {
              templateId: effectiveTemplateId,
              workspacePath: workspacePath || initialWorkspacePath || undefined,
            };
      await onCreate(name.trim(), options);
      setName('');
      setSource('template');
      setWorkspacePath('');
    } catch (error) {
      toast.error(t('toast.agentCreateFailed', { error: String(error) }));
      setSaving(false);
      return;
    }
    setSaving(false);
  };

  const sourceTabClass = (tab: CreateSource) =>
    `flex-1 py-1.5 text-[12px] font-medium rounded-full transition-colors ${
      source === tab ? 'bg-foreground text-background' : 'text-foreground/50 hover:text-foreground'
    }`;

  const canSubmit = useMemo(
    () => !saving && !!name.trim() && (source !== 'agent' || !!effectiveAgentId),
    [saving, name, source, effectiveAgentId]
  );

  return (
    <Dialog open={open} onOpenChange={handleDialogChange}>
      <DialogContent className="flex w-full max-h-[80vh] max-w-md flex-col overflow-hidden rounded-3xl border-0 bg-[#f3f1e9] p-0 shadow-2xl dark:bg-card">
        <DialogHeader className="shrink-0 p-6 pb-2">
          <DialogTitle className="text-2xl font-normal tracking-tight">
            {t('createDialog.title')}
          </DialogTitle>
          <DialogDescription className="mt-1 text-foreground/70">
            {t('createDialog.description')}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto scrollbar-hover p-6 pr-4 pt-4">
          <div className="space-y-2.5">
            <Label htmlFor="agent-name" className={labelClasses}>
              {t('createDialog.nameLabel')}
            </Label>
            <Input
              id="agent-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t('createDialog.namePlaceholder')}
              className={cn(
                'h-[44px] rounded-xl text-sm text-foreground placeholder:text-foreground/40'
              )}
            />
          </div>

          <div className="space-y-2.5">
            <Label className={labelClasses}>{t('createDialog.sourceLabel')}</Label>
            <div className="flex gap-1 p-1 rounded-full bg-black/5 dark:bg-white/5">
              <button
                type="button"
                className={sourceTabClass('template')}
                onClick={() => setSource('template')}
              >
                {t('createDialog.sourceTemplate')}
              </button>
              <button
                type="button"
                className={sourceTabClass('agent')}
                onClick={() => setSource('agent')}
              >
                {t('createDialog.sourceAgent')}
              </button>
            </div>
          </div>

          {source === 'template' && templates.length > 0 && (
            <div className="space-y-2">
              {templates.map((tmpl) => (
                <button
                  key={tmpl.id}
                  type="button"
                  onClick={() => setSelectedTemplateId(tmpl.id)}
                  className={`w-full text-left rounded-2xl border px-4 py-3 transition-colors ${
                    effectiveTemplateId === tmpl.id
                      ? 'border-primary/40 bg-primary/5 dark:bg-primary/10'
                      : 'border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/5'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <div
                      className={`h-3.5 w-3.5 rounded-full border-2 shrink-0 ${
                        effectiveTemplateId === tmpl.id
                          ? 'border-primary bg-primary'
                          : 'border-black/20 dark:border-white/20'
                      }`}
                    />
                    <div>
                      <div className="text-[13px] font-medium text-foreground">{tmpl.name}</div>
                      {tmpl.description && (
                        <div className="text-[12px] text-foreground/50 mt-0.5">{tmpl.description}</div>
                      )}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}

          {source === 'agent' && (
            <div className="space-y-2">
              {agents.length === 0 ? (
                <p className="text-sm text-foreground/50 px-1">
                  {t('createDialog.noAgents')}
                </p>
              ) : (
                agents.map((agent) => (
                  <button
                    key={agent.id}
                    type="button"
                    onClick={() => setSelectedAgentId(agent.id)}
                    className={`w-full text-left rounded-2xl border px-4 py-3 transition-colors ${
                      effectiveAgentId === agent.id
                        ? 'border-primary/40 bg-primary/5 dark:bg-primary/10'
                        : 'border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/5'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <div
                        className={`h-3.5 w-3.5 rounded-full border-2 shrink-0 ${
                          effectiveAgentId === agent.id
                            ? 'border-primary bg-primary'
                            : 'border-black/20 dark:border-white/20'
                        }`}
                      />
                      <div className="text-sm font-medium text-foreground">{agent.name}</div>
                    </div>
                  </button>
                ))
              )}
            </div>
          )}

          {!hideWorkspaceSelector && (
            <div className="space-y-2.5">
              <Label className={labelClasses}>
                {t('createDialog.workspaceLabel')}
              </Label>
              <div className="flex gap-2 items-center">
                <button
                  type="button"
                  onClick={() => void handlePickFolder()}
                  className="flex items-center gap-2 flex-1 text-left rounded-2xl border border-black/10 dark:border-white/10 px-4 py-2.5 hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                >
                  <FolderOpen className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <span
                    className={`text-[13px] truncate ${
                      workspacePath ? 'text-foreground' : 'text-foreground/40'
                    }`}
                  >
                    {workspacePath || t('createDialog.workspacePlaceholder')}
                  </span>
                </button>
                {workspacePath && (
                  <button
                    type="button"
                    onClick={() => setWorkspacePath('')}
                    className="p-1.5 rounded-full hover:bg-black/5 dark:hover:bg-white/5 text-muted-foreground"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
        <DialogFooter className="shrink-0 px-6 pb-4 pt-1">
            <Button
              variant="outline"
              onClick={onClose}
              className="h-9 text-[13px] font-medium rounded-full px-4 border-black/10 dark:border-white/10 bg-transparent hover:bg-black/5 dark:hover:bg-white/5 shadow-none text-foreground/80 hover:text-foreground"
            >
              {t('common:actions.cancel')}
            </Button>
            <Button
              onClick={() => void handleSubmit()}
              disabled={!canSubmit}
              className="h-9 text-[13px] font-medium rounded-full px-4 shadow-none"
            >
              {saving ? (
                <>
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  {t('creating')}
                </>
              ) : (
                t('common:actions.save')
              )}
            </Button>
          </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}