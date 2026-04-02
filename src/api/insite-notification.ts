import apiClient from "./index";

export interface NotificationItem {
  id: number;
  notificationId: number;
  title: string;
  content: string;
  type: string;
  status: string;
  readAt: string | null;
  createdAt: string;
}

export interface Sort {
  empty: boolean;
  sorted: boolean;
  unsorted: boolean;
}

export interface Pageable {
  offset: number;
  sort: Sort;
  unpaged: boolean;
  paged: boolean;
  pageNumber: number;
  pageSize: number;
}

export interface NotificationPageData {
  totalPages: number;
  totalElements: number;
  size: number;
  content: NotificationItem[];
  number: number;
  sort: Sort;
  pageable: Pageable;
  numberOfElements: number;
  first: boolean;
  last: boolean;
  empty: boolean;
}

const getInsiteNotification = (
  page: number,
  size: number
): Promise<NotificationPageData> => {
  return apiClient.get("/api/notifications", { page, size });
};

export { getInsiteNotification };
