import type { BootstrapData, LoginResponse } from '@chores/shared';

const TOKEN_KEY = 'carter-chores:session';

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export function storedToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function storeToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = storedToken();
  const headers = new Headers(init.headers);
  if (init.body) headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const response = await fetch(path, { ...init, headers });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { error?: string };
    throw new ApiError(payload.error ?? 'Something went wrong', response.status);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export function getBootstrap(): Promise<BootstrapData> {
  return api<BootstrapData>('/api/bootstrap');
}

export function login(password: string, userId?: number): Promise<LoginResponse> {
  return api<LoginResponse>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ password, userId }),
  });
}

export function mutate(path: string, method: 'POST' | 'PATCH' | 'DELETE', body?: unknown) {
  return api<void>(path, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
