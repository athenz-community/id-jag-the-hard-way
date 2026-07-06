import { auth } from "@/shared/lib/auth";
import { config } from "@/shared/config";

async function authHeaders() {
  const session = await auth();
  const sessionWithToken = session as { idToken?: unknown } | null;
  const idToken = typeof sessionWithToken?.idToken === "string" ? sessionWithToken.idToken : undefined;
  if (!idToken) throw new Error("Not authenticated");
  return { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" };
}

async function apiErrorMessage(res: Response) {
  const fallback = `API error ${res.status}`;

  try {
    const text = await res.text();
    if (!text) return fallback;

    try {
      const data = JSON.parse(text);
      return data?.message || data?.error || text;
    } catch {
      return text;
    }
  } catch {
    return fallback;
  }
}

export async function getDocs(accessToken?: string): Promise<{ id: number; name: string; content: string }[]> {
  const headers = accessToken
    ? { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" }
    : await authHeaders();
  const res = await fetch(`${config.api.serverUrl}/api/docs`, {
    headers,
    cache: "no-store",
  });
  if (!res.ok) throw new Error(await apiErrorMessage(res));
  const data = await res.json();
  return data.docs;
}

export async function deleteDoc(id: number, accessToken?: string) {
  const headers = accessToken
    ? { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" }
    : await authHeaders();
  const res = await fetch(`${config.api.serverUrl}/api/docs/${id}`, {
    method: "DELETE",
    headers,
  });
  if (!res.ok) throw new Error(await apiErrorMessage(res));
}

export async function createDoc(name: string, content: string, accessToken?: string) {
  const headers = accessToken
    ? { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" }
    : await authHeaders();
  const res = await fetch(`${config.api.serverUrl}/api/docs`, {
    method: "POST",
    headers,
    body: JSON.stringify({ name, content }),
  });
  if (!res.ok) throw new Error(await apiErrorMessage(res));
  return res.json();
}
