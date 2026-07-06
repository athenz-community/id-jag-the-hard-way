"use client";

import { useState, useEffect } from "react";
import AccessTokenPanel from "./AccessTokenPanel";
import DocsSection from "./DocsSection";
import { SignOutButton } from "@/features/auth/ui/SignInButton";
import { fetchAccessToken } from "../api/fetchAt";

interface Doc { id: number; name: string; content: string }

interface Props {
  docs: Doc[];
  fetchError: string | null;
  user?: { name?: string | null; email?: string | null } | null;
}

export default function DocsPageClient({ docs, fetchError, user }: Props) {
  const [accessToken, setAccessToken] = useState<string | undefined>(undefined);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [atError, setAtError] = useState<string | null>(null);

  useEffect(() => {
    fetchAccessToken("api:role.docs-getter api:role.docs-poster api:role.docs-deleter")
      .then((result) => setAccessToken(result.at))
      .catch((e: unknown) => setAtError(e instanceof Error ? e.message : String(e)));
  }, []);

  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 mb-0.5">
            <span className="inline-block w-2 h-2 rounded-full" style={{ background: "var(--line-green)" }} />
            <span className="text-xs font-medium" style={{ color: "var(--line-green)" }}>ID-JAG Demo</span>
          </div>
          <h1 className="text-xl font-bold" style={{ color: "var(--text-primary)" }}>Documents</h1>
        </div>
        <div className="flex items-center gap-3">
          <div className="hidden sm:flex items-center gap-2">
            <div className="text-right">
              <p className="text-xs font-medium" style={{ color: "var(--text-primary)" }}>{user?.name}</p>
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>{user?.email}</p>
            </div>
            <img
              src="/mlajkim.png"
              alt={user?.name ?? "user"}
              width={32}
              height={32}
              className="rounded-full object-cover shrink-0"
              style={{ border: "2px solid var(--border)" }}
            />
          </div>
          <button
            onClick={() => setSettingsOpen(true)}
            title="Access token settings"
            className="p-1.5 rounded-lg hover:opacity-70 transition-opacity"
            style={{ color: "var(--text-muted)", border: "1px solid var(--border)" }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
          <SignOutButton />
        </div>
      </div>

      <DocsSection docs={docs} fetchError={fetchError} accessToken={accessToken} />

      {/* Access token error dialog */}
      {atError && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.5)" }}
          onClick={() => setAtError(null)}
        >
          <div
            className="w-full max-w-sm rounded-2xl p-6 space-y-4"
            style={{ background: "var(--surface)", boxShadow: "var(--shadow-md)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="font-semibold text-sm" style={{ color: "var(--text-primary)" }}>Failed to fetch access token</h2>
            <p className="text-xs break-all font-mono" style={{ color: "#ef4444" }}>{atError}</p>
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => setAtError(null)}
                className="flex-1 rounded-lg border py-2 text-sm font-medium cursor-pointer hover:opacity-70 transition-opacity"
                style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}
              >
                Dismiss
              </button>
              <button
                onClick={() => { setAtError(null); setSettingsOpen(true); }}
                className="flex-1 rounded-lg py-2 text-sm font-medium cursor-pointer hover:opacity-80 transition-opacity"
                style={{ background: "var(--line-green)", color: "#fff" }}
              >
                Open Settings
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Settings modal */}
      {settingsOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.5)" }}
          onClick={() => setSettingsOpen(false)}
        >
          <div
            className="w-full max-w-lg rounded-2xl p-6 space-y-4"
            style={{ background: "var(--surface)", boxShadow: "var(--shadow-md)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-sm" style={{ color: "var(--text-primary)" }}>Access Token Settings</h2>
              <button
                onClick={() => setSettingsOpen(false)}
                className="text-lg leading-none hover:opacity-60"
                style={{ color: "var(--text-muted)" }}
              >
                ✕
              </button>
            </div>
            <AccessTokenPanel onToken={(at) => { setAccessToken(at); setSettingsOpen(false); }} />
          </div>
        </div>
      )}
    </>
  );
}
