import type { GuideTask } from '@/api/users'

export interface UserInfo {
  id: string
  createdTime?: string
  phone: string
  nickName: string
  limitStatus?: number
}

export interface AvatarData {
  color: { r: number; g: number; b: number }
  hash: number
}

export interface Message {
  id: string | number
  title: string
  desc: string
  content: string
  timestamp: string
  isReaded: boolean
}

export type InterceptedAction = (...args: any[]) => void | Promise<void>

export interface LoginState {
  isLoggedIn: boolean
  userInfo: UserInfo | null
  isLoading: boolean
  smsCountdown: number
  messages: Message[]
  readedMessageIds: string[]
  messagePage: number
  messagePageSize: number
  hasMoreMessages: boolean
  isLoadingMessages: boolean
  hasNewbieTourShowed: boolean
  interceptedActions: InterceptedAction[]
  /** 递增即表示请求打开登录弹窗 */
  loginDialogRequest: number
  sendIdeaTourShow: boolean
  missionGroup: GuideTask[]
}

export interface LoginActions {
  setNewbieTourShowed: () => void
  updateLoginStatus: () => void
  saveUserInfo: (info: UserInfo | null) => void
  loadUserInfo: () => UserInfo | null
  saveReadedMessageIds: (ids: string[]) => void
  markMessageAsRead: (messageId: string | number) => void
  updateMessages: () => Promise<Message[]>
  loadMoreMessages: () => Promise<void>
  loginWithTicket: (ticket: string) => Promise<{ success: boolean; message: string }>
  logout: () => void
  initUserInfo: () => void
  requireLogin: <T extends any[]>(action: (...args: T) => void | Promise<void>, ...args: T) => Promise<void>
  clearInterceptedActions: () => void
  executeInterceptedActions: () => Promise<void>
  consumeLoginDialogRequest: () => number
  makeRandomAvatar: (token: string) => AvatarData
  renderAvatarFromData: (avatarData: AvatarData, pixelSize?: number, size?: number) => string
  setSendIdeaTourShow: (show: boolean) => void
  updateNewbieMission: () => Promise<void>
  completeNewbieMissionByCode: (code: string) => Promise<boolean>
  getNewbieMissionProgressPercent: () => string
}

export type LoginStore = LoginState & LoginActions
