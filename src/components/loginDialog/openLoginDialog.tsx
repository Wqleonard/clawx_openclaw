import { createRoot } from 'react-dom/client'
import * as React from 'react'
import { LoginDialog } from './LoginDialog'
import { toast } from 'sonner'

export interface LoginResult {
  success: boolean
  message?: string
}

/**
 * 打开登录对话框（与 Vue 版 showLoginDialog 行为一致）
 * @returns Promise，resolve 表示登录成功，reject 表示用户关闭或取消
 */
export const openLoginDialog = (): Promise<LoginResult> => {
  return new Promise((resolve, reject) => {
    const container = document.createElement('div')
    document.body.appendChild(container)

    let resolved = false

    const setOpenRef: { current: ((open: boolean) => void) | null } = { current: null }

    const onLoginSuccess = () => {
      if (resolved) return
      resolved = true
      setOpenRef.current?.(false)
      toast.success('登录成功')
      setTimeout(() => {
        root.unmount()
        document.body.removeChild(container)
        resolve({ success: true, message: '登录成功' })
      }, 300)
    }

    const onLoginFailed = () => {
      // 不 resolve/reject，保持对话框打开
    }

    const handleOpenChange = (open: boolean) => {
      setOpenRef.current?.(open)
      if (!open && !resolved) {
        resolved = true
        setTimeout(() => {
          root.unmount()
          document.body.removeChild(container)
          reject(new Error('用户关闭对话框'))
        }, 300)
      }
    }

    const App = () => {
      const [open, setOpenState] = React.useState(true)
      React.useEffect(() => {
        setOpenRef.current = setOpenState
        return () => {
          setOpenRef.current = null
        }
      }, [setOpenState])
      return (
        <LoginDialog
          open={open}
          onOpenChange={handleOpenChange}
          onLoginSuccess={onLoginSuccess}
          onLoginFailed={onLoginFailed}
        />
      )
    }

    const root = createRoot(container)
    root.render(<App />)
  })
}
