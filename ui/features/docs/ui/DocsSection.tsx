"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import CreateDocForm from "./CreateDocForm";
import { deleteDocAction, getDocsAction } from "../api/actions";

interface Doc { id: number; name: string; content: string }

interface Props {
  docs: Doc[];
  fetchError: string | null;
  accessToken?: string;
}

export default function DocsSection({ docs: initialDocs, fetchError: initialError, accessToken }: Props) {
  const [docs, setDocs]             = useState<Doc[]>(initialDocs);
  const [fetchError, setFetchError] = useState<string | null>(initialError);
  const [showForm, setShowForm]     = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [confirmDoc, setConfirmDoc] = useState<Doc | null>(null);
  const [newDocId, setNewDocId]     = useState<number | null>(null);
  const [deletedIds, setDeletedIds] = useState<Set<number>>(new Set());

  async function confirmDelete() {
    if (!confirmDoc) return;
    const id = confirmDoc.id;
    setConfirmDoc(null);
    setDeletingId(id);
    const result = await deleteDocAction(id, accessToken);
    if ("error" in result) {
      setFetchError(result.error);
    } else {
      setDeletedIds((prev) => new Set(prev).add(id));
    }
    setDeletingId(null);
  }

  function onDocCreated(doc: Doc) {
    setShowForm(false);
    setDocs((prev) => [doc, ...prev]);
    setNewDocId(doc.id);
    setTimeout(() => setNewDocId(null), 2000);
  }

  async function refresh() {
    setRefreshing(true);
    setFetchError(null);
    const [result] = await Promise.all([
      getDocsAction(accessToken),
      new Promise((r) => setTimeout(r, 1000)),
    ]);
    if (result.error) {
      setFetchError(result.error);
    } else {
      setDocs(result.docs!);
      setDeletedIds(new Set());
    }
    setRefreshing(false);
  }

  return (
    <section>
      {/* Section header */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs font-semibold tracking-wide" style={{ color: "var(--text-secondary)" }}>
          ALL DOCUMENTS
        </h2>
        <div className="flex items-center gap-2">
          {/* Refresh */}
          <button
            onClick={refresh}
            disabled={refreshing}
            title="Refresh list"
            className="p-1 rounded-md transition-opacity hover:opacity-70 disabled:opacity-40"
            style={{ color: "var(--text-muted)" }}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="14" height="14" viewBox="0 0 24 24"
              fill="none" stroke="currentColor" strokeWidth="2"
              strokeLinecap="round" strokeLinejoin="round"
              className={refreshing ? "animate-spin" : ""}
            >
              <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
              <path d="M21 3v5h-5" />
              <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
              <path d="M8 16H3v5" />
            </svg>
          </button>

          {/* New Document toggle */}
          <Button
            size="sm"
            onClick={() => setShowForm((v) => !v)}
            style={{ background: showForm ? "var(--border)" : "var(--line-green)", fontSize: "0.7rem", height: "1.75rem", padding: "0 0.65rem" }}
          >
            {showForm ? "Cancel" : "+ New Document"}
          </Button>
        </div>
      </div>

      {/* New Document modal */}
      {showForm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.5)" }}
          onClick={() => setShowForm(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl p-6"
            style={{ background: "var(--surface)", boxShadow: "var(--shadow-sm)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-sm" style={{ color: "var(--text-primary)" }}>New Document</h2>
              <button
                onClick={() => setShowForm(false)}
                className="text-lg leading-none hover:opacity-60"
                style={{ color: "var(--text-muted)" }}
              >
                ✕
              </button>
            </div>
            <CreateDocForm accessToken={accessToken} onSuccess={onDocCreated} />
          </div>
        </div>
      )}

      {/* Loading state */}
      {refreshing && (
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>Getting documents…</p>
      )}

      {/* Error */}
      {!refreshing && fetchError && (
        <div className="space-y-1">
          <p className="text-sm text-destructive">{fetchError}</p>
          {fetchError.includes("Expired") && (
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              Your session has expired. Please{" "}
              <a href="/api/auth/signin" className="underline" style={{ color: "var(--line-green)" }}>
                sign in again
              </a>{" "}
              to continue.
            </p>
          )}
        </div>
      )}

      {/* List */}
      {!refreshing && !fetchError && (
        docs.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>No documents yet.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {docs.map((doc) => (
              <Card
                key={doc.id}
                style={{
                  borderColor: newDocId === doc.id ? "var(--line-green)" : "var(--border)",
                  boxShadow: newDocId === doc.id ? "0 0 0 2px var(--line-green)" : "var(--shadow-sm)",
                  transition: "border-color 0.6s ease, box-shadow 0.6s ease, opacity 0.4s ease",
                  opacity: deletedIds.has(doc.id) ? 0.4 : 1,
                }}
              >
                <CardHeader className="pb-1 pt-4 px-4">
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle className="text-sm font-semibold truncate" style={{ color: "var(--text-primary)", textDecoration: deletedIds.has(doc.id) ? "line-through" : "none" }}>
                      {doc.name}
                    </CardTitle>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <Badge variant="secondary" className="text-xs">#{doc.id}</Badge>
                      {deletedIds.has(doc.id) ? (
                        <span className="text-xs px-1.5 py-0.5 rounded" style={{ color: "var(--text-muted)", background: "var(--border)" }}>deleted</span>
                      ) : (
                        <button
                          onClick={() => setConfirmDoc(doc)}
                          disabled={deletingId === doc.id}
                          title="Delete document"
                          className="p-0.5 rounded hover:opacity-60 disabled:opacity-30 transition-opacity cursor-pointer"
                          style={{ color: "var(--text-muted)" }}
                        >
                          {deletingId === doc.id ? (
                            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="animate-spin"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg>
                          ) : (
                            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                          )}
                        </button>
                      )}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="px-4 pb-4">
                  <p className="text-sm" style={{ color: "var(--text-secondary)" }}>{doc.content}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        )
      )}
      {/* Delete confirmation modal */}
      {confirmDoc && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.5)" }}
          onClick={() => setConfirmDoc(null)}
        >
          <div
            className="w-full max-w-sm rounded-2xl p-6 space-y-4"
            style={{ background: "var(--surface)", boxShadow: "var(--shadow-sm)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="font-semibold text-sm" style={{ color: "var(--text-primary)" }}>Delete document?</h2>
            <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
              <span className="font-medium" style={{ color: "var(--text-primary)" }}>"{confirmDoc.name}"</span> will be permanently deleted.
            </p>
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => setConfirmDoc(null)}
                className="flex-1 rounded-lg border py-2 text-sm font-medium cursor-pointer hover:opacity-70 transition-opacity"
                style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}
              >
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                className="flex-1 rounded-lg py-2 text-sm font-medium cursor-pointer hover:opacity-80 transition-opacity"
                style={{ background: "#ef4444", color: "#fff" }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
