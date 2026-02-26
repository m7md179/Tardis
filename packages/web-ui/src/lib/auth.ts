const TOKEN_KEY = 'tardis_token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export function isAuthenticated(): boolean {
  return getToken() !== null;
}

export async function login(password: string): Promise<{ success: boolean; error?: string }> {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });

  if (!res.ok) {
    const data = (await res.json()) as { error?: string };
    return { success: false, error: data.error ?? 'Login failed' };
  }

  const data = (await res.json()) as { token: string };
  setToken(data.token);
  return { success: true };
}

export function logout(): void {
  clearToken();
  window.location.href = '/login';
}
