import crypto from "crypto";

type Session = { idToken: string; exp: number };

const store = new Map<string, Session>();

export function createSession(idToken: string, exp: number): string {
  const token = crypto.randomUUID();
  store.set(token, { idToken, exp });
  return token;
}

export function getSession(bearerToken: string): Session | null {
  const s = store.get(bearerToken);
  if (!s) return null;
  if (s.exp <= Math.floor(Date.now() / 1000)) {
    store.delete(bearerToken);
    return null;
  }
  return s;
}
