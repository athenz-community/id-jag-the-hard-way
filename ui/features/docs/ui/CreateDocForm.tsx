"use client";

import { useActionState, useState } from "react";
import { createDocAction } from "../api/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface Doc { id: number; name: string; content: string }
interface Props { onSuccess?: (doc: Doc) => void; accessToken?: string }

export default function CreateDocForm({ onSuccess, accessToken }: Props = {}) {
  const [name, setName]       = useState("");
  const [content, setContent] = useState("");
  const ready = name.trim().length > 0 && content.trim().length > 0;

  const [fakeLoading, setFakeLoading] = useState(false);

  const [state, action, pending] = useActionState(
    async (prev: any, formData: FormData) => {
      setFakeLoading(true);
      await new Promise((r) => setTimeout(r, 1000));
      setFakeLoading(false);
      const result = await createDocAction(prev, formData);
      if (result?.success && result.doc) onSuccess?.(result.doc);
      return result;
    },
    null,
  );

  return (
    <form action={action} className="space-y-4">
      {accessToken && <input type="hidden" name="accessToken" value={accessToken} />}
      <div className="space-y-1.5">
        <Label htmlFor="name" className="text-xs" style={{ color: "var(--text-secondary)" }}>Title</Label>
        <Input
          id="name" name="name" placeholder="My doc" required autoComplete="off"
          value={name} onChange={(e) => setName(e.target.value)}
          autoFocus
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="content" className="text-xs" style={{ color: "var(--text-secondary)" }}>Content</Label>
        <Input
          id="content" name="content" placeholder="Write something…" required autoComplete="off"
          value={content} onChange={(e) => setContent(e.target.value)}
        />
      </div>

      {state?.error && (
        <p className="text-xs text-destructive">{state.error}</p>
      )}

      <Button
        type="submit"
        disabled={!ready || pending}
        className="w-full transition-colors"
        style={{
          background: ready ? "var(--line-green)" : "var(--border)",
          color: ready ? "#fff" : "var(--text-muted)",
          cursor: ready ? "pointer" : "not-allowed",
        }}
      >
        {fakeLoading ? "Posting…" : pending ? "Creating…" : "Create"}
      </Button>
    </form>
  );
}
