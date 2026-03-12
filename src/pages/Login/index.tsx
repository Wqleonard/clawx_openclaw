import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useLoginStore } from '@/stores/loginStore';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Bot, Terminal, Zap, Layers } from 'lucide-react';

const IFRAME_URL = 'https://www.baowenmao.com/login/login';
const ALLOWED_ORIGIN = 'https://www.baowenmao.com';
const LOAD_TIMEOUT_MS = 5000;

export function Login() {
  const navigate = useNavigate();
  const loginWithTicket = useLoginStore((s) => s.loginWithTicket);
  const executeInterceptedActions = useLoginStore((s) => s.executeInterceptedActions);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [iframeLoadFailed, setIframeLoadFailed] = useState(false);
  const loadTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleMessage = useCallback(
    async (event: MessageEvent) => {
      if (event.origin !== ALLOWED_ORIGIN) return;
      if (!event.data?.action) return;

      try {
        const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
        if (data?.action === 'ticketSend' && data?.data?.ticket) {
          const ticket = data.data.ticket as string;
          const req = await loginWithTicket(ticket);
          if (req?.success) {
            toast.success('登录成功');
            await executeInterceptedActions();
            navigate('/');
          } else {
            toast.error(req?.message || '登录失败');
          }
        }
      } catch {
        toast.error('登录失败，请重试');
      }
    },
    [loginWithTicket, executeInterceptedActions, navigate]
  );

  useEffect(() => {
    window.addEventListener('message', handleMessage);
    setIframeLoadFailed(false);

    loadTimeoutRef.current = setTimeout(() => {
      const iframe = iframeRef.current;
      if (iframe) {
        try {
          const iframeDoc = iframe.contentDocument ?? iframe.contentWindow?.document;
          if (!iframeDoc?.body || iframeDoc.body.children.length === 0) {
            setIframeLoadFailed(true);
          }
        } catch {
          setIframeLoadFailed(true);
        }
      }
    }, LOAD_TIMEOUT_MS);

    return () => {
      window.removeEventListener('message', handleMessage);
      if (loadTimeoutRef.current) {
        clearTimeout(loadTimeoutRef.current);
        loadTimeoutRef.current = null;
      }
    };
  }, [handleMessage]);

  const handleIframeLoad = useCallback(() => {
    if (loadTimeoutRef.current) {
      clearTimeout(loadTimeoutRef.current);
      loadTimeoutRef.current = null;
    }
    setIframeLoadFailed(false);
  }, []);

  const handleIframeError = useCallback(() => {
    setIframeLoadFailed(true);
    if (loadTimeoutRef.current) {
      clearTimeout(loadTimeoutRef.current);
      loadTimeoutRef.current = null;
    }
  }, []);

  const handleRetry = useCallback(() => {
    setIframeLoadFailed(false);
  }, []);

  const features = [
    { icon: Bot, title: 'AI Agent 运行时', desc: '内置 OpenClaw Gateway，支持多模型 Agent 编排' },
    { icon: Terminal, title: '完整终端能力', desc: '原生 PTY 终端，支持复杂命令行工作流' },
    { icon: Zap, title: '自家模型接入', desc: '无缝切换 OpenClaw 与自家 AI 模型' },
    { icon: Layers, title: '技能市场', desc: '丰富的技能生态，一键安装扩展能力' },
  ];

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background">
      {/* Left panel */}
      <div className="hidden lg:flex lg:w-1/2 flex-col justify-between bg-muted/30 border-r border-border p-12">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary">
            <Bot className="h-5 w-5 text-primary-foreground" />
          </div>
          <span className="text-xl font-semibold tracking-tight">BoomClaw</span>
        </div>

        <div className="space-y-8">
          <div>
            <h1 className="text-3xl font-bold leading-tight text-foreground">
              AI Agent 桌面工作台
            </h1>
            <p className="mt-3 text-muted-foreground text-base leading-relaxed">
              基于 OpenClaw 构建的增强型桌面应用，保留完整终端与 Agent 能力，同时接入自家 AI 模型与业务接口。
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4">
            {features.map(({ icon: Icon, title, desc }) => (
              <div key={title} className="flex items-start gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10">
                  <Icon className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <div className="text-sm font-medium text-foreground">{title}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          © {new Date().getFullYear()} BoomClaw. All rights reserved.
        </p>
      </div>

      {/* Right panel — login module */}
      <div className="flex flex-1 flex-col items-center justify-center p-8">
        <div className="w-full max-w-[400px]">
          {/* Mobile logo */}
          <div className="flex lg:hidden items-center gap-2 mb-8 justify-center">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
              <Bot className="h-4 w-4 text-primary-foreground" />
            </div>
            <span className="text-lg font-semibold">BoomClaw</span>
          </div>

          <div className="mb-6 text-center lg:text-left">
            <h2 className="text-2xl font-bold text-foreground">欢迎回来</h2>
            <p className="mt-1 text-sm text-muted-foreground">登录以继续使用 BoomClaw</p>
          </div>

          <div
            className={cn(
              'relative overflow-hidden rounded-xl border border-border bg-card shadow-sm',
              'h-[520px] w-full'
            )}
          >
            {!iframeLoadFailed ? (
              <iframe
                ref={iframeRef}
                src={IFRAME_URL}
                title="登录"
                sandbox="allow-same-origin allow-scripts allow-popups allow-forms"
                allow="camera; microphone"
                className="h-full w-full border-0"
                onLoad={handleIframeLoad}
                onError={handleIframeError}
              />
            ) : (
              <div className="flex h-full w-full flex-col items-center justify-center gap-3 px-6">
                <div className="text-center text-base text-muted-foreground">无法加载登录页面</div>
                <div className="text-center text-sm text-muted-foreground">请检查网络连接或稍后重试</div>
                <Button onClick={handleRetry} className="mt-2">
                  重新加载
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
