
import { useCallback, useEffect, useRef, useState } from 'react'
import { Dialog, DialogContent, DialogTitle, VisuallyHidden } from '@/components/ui/dialog'
import { useLoginStore } from '@/stores/loginStore'

import { toast } from "sonner";
import { cn } from '@/lib/utils'
import { Button } from "@/components/ui/button.tsx";

const IFRAME_URL = 'https://www.baowenmao.com/login/login'
const ALLOWED_ORIGIN = 'https://www.baowenmao.com'
const LOAD_TIMEOUT_MS = 5000

export interface LoginDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onLoginSuccess?: () => void
  onLoginFailed?: () => void
}

export const LoginDialog = ({ open, onOpenChange, onLoginSuccess, onLoginFailed }: LoginDialogProps) => {
  const loginWithTicket = useLoginStore((s) => s.loginWithTicket)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [iframeLoadFailed, setIframeLoadFailed] = useState(false)
  const loadTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const onSuccessRef = useRef(onLoginSuccess)
  const onFailedRef = useRef(onLoginFailed)
  useEffect(() => {
    onSuccessRef.current = onLoginSuccess
    onFailedRef.current = onLoginFailed
  }, [onLoginSuccess, onLoginFailed])

  const handleMessage = useCallback(async (event: MessageEvent) => {
    if (event.origin !== ALLOWED_ORIGIN) return
    if (!event.data?.action) return

    try {
      const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data
      if (data?.action === 'ticketSend' && data?.data?.ticket) {
        const ticket = data.data.ticket as string
        const req = await loginWithTicket(ticket)
        if (req?.success) {
          onSuccessRef.current?.()
        } else {
          toast.error(req?.message || '登录失败')
          onFailedRef.current?.()
        }
      }
    } catch {
      onFailedRef.current?.()
    }
  }, [loginWithTicket])

  useEffect(() => {
    if (!open) return
    window.addEventListener('message', handleMessage)
    setTimeout(() => {
      setIframeLoadFailed(false)
    }, 0)

    loadTimeoutRef.current = setTimeout(() => {
      const iframe = iframeRef.current
      if (iframe) {
        try {
          const iframeDoc = iframe.contentDocument ?? iframe.contentWindow?.document
          if (!iframeDoc?.body || iframeDoc.body.children.length === 0) {
            setIframeLoadFailed(true)
          }
        } catch {
          setIframeLoadFailed(true)
        }
      }
    }, LOAD_TIMEOUT_MS)

    return () => {
      window.removeEventListener('message', handleMessage)
      if (loadTimeoutRef.current) {
        clearTimeout(loadTimeoutRef.current)
        loadTimeoutRef.current = null
      }
    }
  }, [open, handleMessage])

  const handleIframeLoad = useCallback(() => {
    if (loadTimeoutRef.current) {
      clearTimeout(loadTimeoutRef.current)
      loadTimeoutRef.current = null
    }
    setIframeLoadFailed(false)
  }, [])

  const handleIframeError = useCallback(() => {
    setIframeLoadFailed(true)
    if (loadTimeoutRef.current) {
      clearTimeout(loadTimeoutRef.current)
      loadTimeoutRef.current = null
    }
  }, [])

  const handleRetry = useCallback(() => {
    setIframeLoadFailed(false)
  }, [])

  const preventClose = useCallback((e: Event) => {
    e.preventDefault()
  }, [])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton
        className={cn(
          'p-0 gap-0 overflow-hidden',
           'w-[calc(400px+32px*2)] max-w-[calc(100%-2rem)]',
        )}
        onInteractOutside={preventClose}
        onEscapeKeyDown={preventClose}
      >
        <VisuallyHidden>
          <DialogTitle>登录</DialogTitle>
        </VisuallyHidden>
        <div
          className={cn(
            'relative overflow-hidden w-full h-[560px]'
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
            <div className="flex h-full w-full flex-col items-center justify-center rounded border border-gray-200 bg-gray-50 px-4">
              <div className="mb-2 text-center text-lg text-gray-500">无法加载登录页面</div>
              <div className="mb-4 text-center text-sm text-gray-500">请检查网络连接或稍后重试</div>
              <Button
                role="button"
                tabIndex={0}
                className="cursor-pointer rounded  px-4 py-2 text-white "
                onClick={handleRetry}
                onKeyDown={(e) => e.key === 'Enter' && handleRetry()}
              >
                重新加载
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
