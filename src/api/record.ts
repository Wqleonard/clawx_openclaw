import apiClient from "./index";

type ChatRecordType = 'official_api' | 'custom';
type ChatRecordSource = 'platform' | 'wechat' | 'qq' | 'feishu' | 'wecom';

const postChatRecord = (type: ChatRecordType, source: ChatRecordSource) => {
  return apiClient.post('/chat-records', {
    type,
    source,
  });
};

export { postChatRecord };