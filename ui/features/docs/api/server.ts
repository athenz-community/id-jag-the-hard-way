import { auth } from "@/shared/lib/auth";
import { config } from "@/shared/config";

async function authHeaders() {
  const session = await auth();
  const idToken = (session as any)?.idToken as string | undefined;
  if (!idToken) throw new Error("Not authenticated");
  return { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" };
}

export async function getDocs(accessToken?: string): Promise<{ id: number; name: string; content: string }[]> {
  const headers = accessToken
    ? { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" }
    : await authHeaders();
  const res = await fetch(`${config.api.serverUrl}/api/docs`, {
    headers,
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`API error ${res.status}`);
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
  if (!res.ok) throw new Error(`API error ${res.status}`);
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
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res.json();
}
