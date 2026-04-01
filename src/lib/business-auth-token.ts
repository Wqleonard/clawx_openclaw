let businessAuthToken = '';

export function getBusinessAuthToken(): string {
  return businessAuthToken;
}

export function setBusinessAuthToken(token: string | null | undefined): void {
  businessAuthToken = String(token ?? '').trim();
}

export function clearBusinessAuthToken(): void {
  businessAuthToken = '';
}
