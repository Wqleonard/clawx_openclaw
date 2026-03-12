import { create } from 'zustand'
import { verifyTicket, getNewbieMission, completeNewbieMissionReq, type GuideTask } from '@/api/users'
import { getInsiteNotification, type NotificationItem } from '@/api/insite-notification'
import type {
  UserInfo,
  AvatarData,
  Message,
  LoginStore,
} from './types'

export type { UserInfo, AvatarData, Message, InterceptedAction, LoginStore } from './types'

const NEWBIE_TOUR_STORAGE_KEY = 'hasNewbieTourShowed'
const READED_IDS_KEY = 'readedMessageIds'

function loadReadedMessageIdsFromStorage(): string[] {
  try {
    const saved = localStorage.getItem(READED_IDS_KEY)
    if (saved) {
      const parsed = JSON.parse(saved)
      return Array.isArray(parsed) ? parsed : []
    }
  } catch {
    localStorage.removeItem(READED_IDS_KEY)
  }
  return []
}

function formatTimestamp(createdAt: string): string {
  if (!createdAt) return '刚刚'
  const now = new Date()
  const date = new Date(createdAt)
  const diffMs = now.getTime() - date.getTime()
  const diffMinutes = Math.floor(diffMs / (1000 * 60))
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
  if (diffMinutes < 1) return '刚刚'
  if (diffMinutes < 60) return `${diffMinutes}分钟前`
  if (diffHours < 24) return `${diffHours}小时前`
  if (diffDays < 7) return `${diffDays}天前`
  return date.toLocaleDateString('zh-CN')
}

function extractDescFromContent(content: string): string {
  if (!content || typeof content !== 'string') return ''
  const tagPattern = /<(p|h1|h2|h3|h4)[^>]*>([\s\S]*?)<\/\1>/i
  const match = content.match(tagPattern)
  if (match?.[2]) {
    const textContent = match[2]
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&[a-z0-9]+;/gi, '')
      .replace(/\s+/g, ' ')
      .trim()
    return textContent || '...'
  }
  return '...'
}

function makeRandomAvatar(token: string): AvatarData {
  const codes = token.split('').map((c) => c.charCodeAt(0))
  let r = 0,
    g = 0,
    b = 0
  for (let i = 0; i < codes.length; i++) {
    r = (r + codes[i] * 1) % 256
    g = (g + codes[i] * 2) % 256
    b = (b + codes[i] * 3) % 256
  }
  let hash = 0
  if (token.length > 0) {
    for (let i = 0; i < token.length; i++) {
      hash = (hash << 5) - hash + token.charCodeAt(i)
      hash |= 0
    }
  }
  return { color: { r, g, b }, hash }
}

function renderAvatarFromData(
  avatarData: AvatarData,
  pixelSize: number = 50,
  size: number = 250
): string {
  const canvas = document.createElement('canvas')
  canvas.height = size
  canvas.width = size
  const ctx = canvas.getContext('2d', { willReadFrequently: false })
  if (!ctx) throw new Error('无法获取canvas context')
  ctx.imageSmoothingEnabled = false
  const { color, hash } = avatarData
  const centerX = size / 2
  const centerY = size / 2
  const radius = size / 2
  ctx.beginPath()
  ctx.arc(centerX, centerY, radius, 0, Math.PI * 2)
  ctx.clip()
  const patternSize = size * 0.7
  const patternWidth = pixelSize * 5
  const scale = patternSize / patternWidth
  const scaledPixelSize = pixelSize * scale
  const offsetX = Math.round((size - patternSize) / 2)
  const offsetY = Math.round((size - patternSize) / 2)
  ctx.fillStyle = `rgb(${color.r}, ${color.g}, ${color.b})`
  for (let i = 0; i < 15; ++i) {
    const col = Math.floor(i / 5)
    const row = i % 5
    const bit = (hash >> i) & 1
    if (bit) {
      const x1 = Math.round(offsetX + col * scaledPixelSize)
      const y1 = Math.round(offsetY + row * scaledPixelSize)
      const pixelSizeInt = Math.ceil(scaledPixelSize)
      ctx.fillRect(x1, y1, pixelSizeInt, pixelSizeInt)
      if (i < 10) {
        const x2 = Math.round(offsetX + (4 - col) * scaledPixelSize)
        ctx.fillRect(x2, y1, pixelSizeInt, pixelSizeInt)
      }
    }
  }
  return canvas.toDataURL('image/png')
}

function getAvatarDataUrl(userInfo: UserInfo | null): string {
  return renderAvatarFromData(
    makeRandomAvatar(userInfo?.phone ?? '13600008888')
  )
}

export const useLoginStore = create<LoginStore>((set, get) => {
  const readedIds = loadReadedMessageIdsFromStorage()
  let savedUserInfo: UserInfo | null = null
  try {
    const saved = localStorage.getItem('userInfo')
    if (saved) savedUserInfo = JSON.parse(saved)
  } catch {
    localStorage.removeItem('userInfo')
  }

  return {
    isLoggedIn: !!localStorage.getItem('token'),
    userInfo: savedUserInfo,
    loginType: 'account',
    isLoading: false,
    smsCountdown: 0,
    messages: [],
    readedMessageIds: readedIds,
    messagePage: 0,
    messagePageSize: 20,
    hasMoreMessages: true,
    isLoadingMessages: false,
    hasNewbieTourShowed: localStorage.getItem(NEWBIE_TOUR_STORAGE_KEY) === 'true',
    interceptedActions: [],
    loginDialogRequest: 0,
    sendIdeaTourShow: false,
    missionGroup: [],

    setNewbieTourShowed: () => {
      set({ hasNewbieTourShowed: true })
      localStorage.setItem(NEWBIE_TOUR_STORAGE_KEY, 'true')
    },

    updateLoginStatus: () => {
      set({ isLoggedIn: !!localStorage.getItem('token') })
    },

    saveUserInfo: (info) => {
      if (info) {
        localStorage.setItem('userInfo', JSON.stringify(info))
        set({ userInfo: info })
      } else {
        localStorage.removeItem('userInfo')
        set({ userInfo: null })
      }
    },

    loadUserInfo: () => {
      try {
        const saved = localStorage.getItem('userInfo')
        if (saved) {
          const parsed = JSON.parse(saved)
          set({ userInfo: parsed })
          return parsed
        }
      } catch {
        localStorage.removeItem('userInfo')
        set({ userInfo: null })
      }
      return null
    },

    saveReadedMessageIds: (ids) => {
      try {
        localStorage.setItem(READED_IDS_KEY, JSON.stringify(ids))
        set({ readedMessageIds: ids })
      } catch (e) {
        console.error('保存已读消息ID失败:', e)
      }
    },

    markMessageAsRead: (messageId) => {
      const idStr = String(messageId)
      const { readedMessageIds, messages } = get()
      if (readedMessageIds.includes(idStr)) return
      const updatedIds = [...readedMessageIds, idStr]
      get().saveReadedMessageIds(updatedIds)
      const nextMessages = messages.map((msg) =>
        String(msg.id) === idStr ? { ...msg, isReaded: true } : msg
      )
      set({ messages: nextMessages })
    },

    updateMessages: async () => {
      const { isLoadingMessages, messagePageSize } = get()
      if (isLoadingMessages) return get().messages
      set({
        isLoadingMessages: true,
        messagePage: 0,
        hasMoreMessages: true,
        readedMessageIds: loadReadedMessageIdsFromStorage(),
      })
      try {
        const response = await getInsiteNotification(0, messagePageSize)
        const ids = get().readedMessageIds
        const convert = (n: NotificationItem): Message => ({
          id: n.id,
          title: n.title,
          desc: extractDescFromContent(n.content),
          content: n.content,
          timestamp: formatTimestamp(n.createdAt),
          isReaded: ids.includes(String(n.id)),
        })
        const list = response?.content?.map(convert) ?? []
        set({
          messages: list,
          hasMoreMessages: response?.last !== true,
          messagePage: 0,
        })
        return list
      } catch (e) {
        console.error('更新消息列表失败:', e)
        set({ messages: [], hasMoreMessages: false })
        throw e
      } finally {
        set({ isLoadingMessages: false })
      }
    },

    loadMoreMessages: async () => {
      const { isLoadingMessages, hasMoreMessages, messagePage, messagePageSize, messages } =
        get()
      if (isLoadingMessages || !hasMoreMessages) return
      set({ isLoadingMessages: true })
      try {
        const nextPage = messagePage + 1
        const response = await getInsiteNotification(nextPage, messagePageSize)
        const ids = get().readedMessageIds
        const convert = (n: NotificationItem): Message => ({
          id: n.id,
          title: n.title,
          desc: extractDescFromContent(n.content),
          content: n.content,
          timestamp: formatTimestamp(n.createdAt),
          isReaded: ids.includes(String(n.id)),
        })
        if (response?.content?.length) {
          const next = [...messages, ...response.content.map(convert)]
          set({
            messages: next,
            hasMoreMessages: !response.last,
            messagePage: nextPage,
          })
        } else {
          set({ hasMoreMessages: false })
        }
      } catch (e) {
        console.error('加载更多消息失败:', e)
        set({ hasMoreMessages: false })
      } finally {
        set({ isLoadingMessages: false })
      }
    },

    loginWithTicket: async (ticket: string) => {
      set({ isLoading: true })
      const invitationCode = localStorage.getItem('invitation_code_new') ?? ''
      try {
        const req: any = await verifyTicket(ticket, invitationCode)
        if (req?.token) {
          localStorage.setItem('token', req.token)
        }
        if (req?.user) {
          get().saveUserInfo(req.user)
        }
        get().updateLoginStatus()
        return { success: true, message: '登录成功' }
      } catch (err: any) {
        console.error('Login Error:', err)
        return {
          success: false,
          message: err?.response?.data?.message ?? '登录失败',
        }
      } finally {
        set({ isLoading: false })
      }
    },

    logout: () => {
      get().saveUserInfo(null)
      localStorage.removeItem('token')
      localStorage.removeItem('___first_in_editor___')
      get().updateLoginStatus()
      get().clearInterceptedActions()
      if (typeof window !== 'undefined') {
        window.location.href = '/'
      }
    },

    initUserInfo: () => {
      get().loadUserInfo()
      get().updateLoginStatus()
    },

    clearInterceptedActions: () => set({ interceptedActions: [] }),

    executeInterceptedActions: async () => {
      const actions = [...get().interceptedActions]
      set({ interceptedActions: [] })
      for (const action of actions) {
        try {
          const result = action()
          if (result instanceof Promise) await result
        } catch (e) {
          console.error('执行被拦截的操作时出错:', e)
        }
      }
    },

    consumeLoginDialogRequest: () => {
      const v = get().loginDialogRequest
      set({ loginDialogRequest: v + 1 })
      return v + 1
    },

    requireLogin: async (action, ...args) => {
      if (get().isLoggedIn) {
        const result = action(...args)
        return result instanceof Promise ? result : Promise.resolve()
      }
      set((s) => ({
        interceptedActions: [...s.interceptedActions, () => action(...args)],
        loginDialogRequest: s.loginDialogRequest + 1,
      }))

      // 桌面端：跳转到登录页，登录成功后由 Login 页面执行被拦截的操作
      if (typeof window !== 'undefined') {
        window.location.hash = '#/login'
      }
      return Promise.reject(new Error('需要登录'))
    },

    makeRandomAvatar,
    renderAvatarFromData,

    setSendIdeaTourShow: (show) => set({ sendIdeaTourShow: show }),

    updateNewbieMission: async () => {
      if (!get().isLoggedIn) return
      try {
        const res = await getNewbieMission()
        const tasks = res?.tasks
        if (Array.isArray(tasks)) {
          set({ missionGroup: tasks })
        }
      } catch (error) {
        console.error(error)
      }
    },

    completeNewbieMissionByCode: async (code: string): Promise<boolean> => {
      try {
        if (!code) return false
        if (!get().isLoggedIn) return false

        // 如果没有初始化任务组，则先初始化
        if (!get().missionGroup.length) {
          await get().updateNewbieMission()
        }

        const findTaskByCode = (tasks: GuideTask[]): GuideTask | null => {
          for (const task of tasks) {
            if (task.code === code) return task
            if (task.children?.length) {
              const found = findTaskByCode(task.children)
              if (found) return found
            }
          }
          return null
        }

        const task = findTaskByCode(get().missionGroup)
        if (!task) {
          console.warn(`未找到任务代码: ${code}`)
          return false
        }

        if (task.status === 1) {
          console.log(`任务 ${code} 已完成`)
          return true
        }

        await completeNewbieMissionReq(task.taskId)
        await get().updateNewbieMission()
        return true
      } catch (error) {
        console.error(`完成任务 ${code} 失败:`, error)
        return false
      }
    },

    getNewbieMissionProgressPercent: () => {
      const countTasks = (tasks: GuideTask[]): { total: number; done: number } => {
        let total = 0
        let done = 0

        tasks.forEach((task) => {
          total++
          if (task.status === 1) {
            done++
          }

          if (task.children && task.children.length > 0) {
            const childStats = countTasks(task.children)
            total += childStats.total
            done += childStats.done
          }
        })

        return { total, done }
      }

      const tasks = get().missionGroup
      if (!tasks || tasks.length === 0) return '0%'

      const { total, done } = countTasks(tasks)

      if (total === 0) return '0%'

      const percent = Math.round((done / total) * 100)
      return `${percent}%`
    },
  }
})

export const selectIsLoggedIn = (s: LoginStore) => s.isLoggedIn
export const selectUserInfo = (s: LoginStore) => s.userInfo
export const selectAvatarDataUrl = (s: LoginStore) => getAvatarDataUrl(s.userInfo)
export const selectHasUnreadMessages = (s: LoginStore) =>
  s.messages.some((m) => !m.isReaded)
export const hasNewbieTourShowed = (s:LoginStore) => s.hasNewbieTourShowed
