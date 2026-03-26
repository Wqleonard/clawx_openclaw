import apiClient from './index';
import { hostApiFetch } from '@/lib/host-api';
import { getOrCreateVisitorId } from '@/utils/visitorId';

interface RegisterInfo {
  phone: string | number;
  password: string;
  nickName?: string;
  invitationCode: string;
}

interface LoginInfo {
  phone: string | number;
  password: string;
}

const createNewUserReq = (registerInfo: RegisterInfo) => {
  return apiClient.post('/api/users/register', {
    phone: registerInfo.phone,
    password: registerInfo.password,
    invitationCode: registerInfo.invitationCode,
    nickName: registerInfo.nickName ? registerInfo.nickName : undefined,
  });
};

const loginReq = (loginInfo: LoginInfo) => {
  return apiClient.post('/api/users/login', {
    phone: loginInfo.phone,
    password: loginInfo.password,
  });
};

// 测试模拟登录
const loginWithTestReq = () => {
  const rawBase = (import.meta.env.VITE_BUSINESS_API_BASE_URL as string | undefined)?.trim() ?? '';
  const baseUrl = rawBase.replace(/\/+$/, '');
  return hostApiFetch('/api/app/mock-login', {
    method: 'POST',
    body: JSON.stringify({
      baseUrl,
      username: 'southwind',
      password: '123456',
    }),
  });
};

const postSuggestsReq = (suggest: string, contactNumber?: string) => {
  return apiClient.post('/api/users/suggests', {
    content: suggest,
    contactNumber: contactNumber ? contactNumber : undefined,
  });
};

const getUserInfoReq = () => {
  return apiClient.get('/me');
};

const getUserBalanceReq = () => {
  return apiClient.get('/api/users/balance');
};

const getInvitationCodeReq = () => {
  return apiClient.get('/api/users/invitation-code');
};

const useInvitationCodeReq = (invitationCode: string) => {
  return apiClient.post('/api/users/invitation-code', {
    invitationCode,
  });
};

const getFrozenUserEmailReq = () => {
  return apiClient.get('/api/users/is-have-frozen-user-email');
};

const postFrozenUserEmailReq = (email: string) => {
  return apiClient.post('/api/users/frozen-user-email', {
    email,
  });
};

// 使用兑换码兑换贝壳
const postRedeemPointsReq = (code: string) => {
  return apiClient.post('/redemption-codes/redeem', {
    code,
  });
};

/**
 * 查询当前用户贝壳消耗记录
 * 接口返回结果直接就是 data
 */
const getPointsConsumption = (params?: { page: number, page_size: number }): Promise<any> => {
  const queryParams: Record<string, number | string> = {
    page: params?.page ?? 1,
    page_size: params?.page_size ?? 20,
  };
  return apiClient.get<any>("/point-consumptions", queryParams);
};

interface UserInfo {
  nickName: string;
  coverImgUrl: string;
}

const updateUserInfo = (data: Partial<UserInfo>) => {
  return apiClient.put('/api/users', data);
};

const updatePassword = (oldPassword: string, newPassword: string) => {
  return apiClient.put('/api/users/password', {
    oldPassword,
    newPassword,
  });
};

const verifyTicket = async (ticket: string, invitationCode: string = '') => {
  // 注意：/auth/login 返回的是原始 token 对象（非 { code, message, data } 包装），
  // 这里需要直接使用底层 axios 实例拿到 response.data。
  const response = await apiClient.post('/auth/login', {
    ticket,
    invitationCode,
  });
  return response;
};

export interface GuideTask {
  code: string;
  taskId: number;
  type: string;
  name: string;
  description: string;
  status: number;
  rewardPoints: number;
  linkUrl: string;
  children: GuideTask[];
}

export interface GetNewbieMissionData {
  tasks: GuideTask[];
}

const getNewbieMission = () => {
  return apiClient.get<GetNewbieMissionData>('/api/users/guide/tasks');
};

const completeNewbieMissionReq = (taskId: number) => {
  return apiClient.post(`/api/users/guide/tasks/${taskId}/complete`);
};

const visitorPost = () => {
  const token = localStorage.getItem('token')?.trim() || '';
  const visitorId = getOrCreateVisitorId();

  if (token) {
    return
  }
  const headers = {
    'X-Visitor-Id': visitorId,
  }

  return apiClient.post('/visitor/report', undefined, {
    headers,
    skipAutoAuthHeader: true,
  });
};

export {
  getUserBalanceReq,
  createNewUserReq,
  useInvitationCodeReq,
  loginReq,
  postSuggestsReq,
  getUserInfoReq,
  getPointsConsumption,
  getInvitationCodeReq,
  updateUserInfo,
  updatePassword,
  verifyTicket,
  postFrozenUserEmailReq,
  getFrozenUserEmailReq,
  getNewbieMission,
  completeNewbieMissionReq,
  visitorPost,
  loginWithTestReq,
  postRedeemPointsReq,
};
