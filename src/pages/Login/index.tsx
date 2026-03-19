import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useLoginStore } from '@/stores/loginStore';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import loginBg from '@/assets/login_back.png';

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
    setTimeout(() => {
      setIframeLoadFailed(false);
    }, 0);

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

  return (
    <div
      className="flex h-screen w-screen items-center justify-end overflow-hidden pr-24"
      style={{ backgroundImage: `url(${loginBg})`, backgroundSize: 'cover', backgroundPosition: 'center' }}
    >
      <div className="w-full max-w-[400px]">
        <div
          className={cn(
            'relative overflow-hidden rounded-xl bg-card shadow-lg',
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
  );
}
