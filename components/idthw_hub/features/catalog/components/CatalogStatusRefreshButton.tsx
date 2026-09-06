"use client"

import { RefreshCw } from "lucide-react"
import { useRouter } from "next/navigation"
import { useTransition } from "react"

export function CatalogStatusRefreshButton() {
  const router = useRouter()
  const [isRefreshing, startRefresh] = useTransition()

  return (
    <button
      className="button catalog-status-refresh"
      type="button"
      disabled={isRefreshing}
      onClick={() => startRefresh(() => router.refresh())}
    >
      <RefreshCw
        className={isRefreshing ? "catalog-refresh-icon spinning" : "catalog-refresh-icon"}
        size={14}
        aria-hidden="true"
      />
      {isRefreshing ? "Refreshing..." : "Refresh status"}
    </button>
  )
}
