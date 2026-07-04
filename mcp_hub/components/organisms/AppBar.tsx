"use client"

import { Bell, ChevronDown, Grip, Sparkles, TerminalSquare } from "lucide-react"
import Image from "next/image"
import { usePathname } from "next/navigation"
import { displayProduct, parseConsoleRoute } from "@/components/navigation/consoleRoute"

export function AppBar() {
  const route = parseConsoleRoute(usePathname())

  return (
    <header className="top-header">
      <div className="header-left">
        <div className="logo-mark" aria-label="IDTHW">
          <Image src="/icons/cloud.png" alt="" width={28} height={28} className="brand-logo-image" />
          <span className="logo-text">IDTHW</span>
        </div>
        <button className="env-select" type="button" disabled>
          <span className="select-name">Dev</span>
          <ChevronDown size={12} aria-hidden="true" />
        </button>
        <button className="context-select" type="button" disabled>
          <span className="select-type">Project</span>
          <span className="select-name">
            {route.project}
            <ChevronDown size={12} aria-hidden="true" />
          </span>
        </button>
        <button className="context-select" type="button" disabled>
          <span className="select-type">Product</span>
          <span className="select-name">
            {displayProduct(route.product)}
            <ChevronDown size={12} aria-hidden="true" />
          </span>
        </button>
      </div>

      <div className="header-right">
        <button className="region-select" type="button" disabled>
          <span className="select-type">Region</span>
          <span className="select-name">local</span>
        </button>
        <button className="icon-button" aria-label="AI assistant" type="button" disabled>
          <Sparkles size={16} aria-hidden="true" />
        </button>
        <button className="icon-button" aria-label="Cloud shell" type="button" disabled>
          <TerminalSquare size={16} aria-hidden="true" />
        </button>
        <button className="icon-button" aria-label="Notifications" type="button" disabled>
          <Bell size={16} aria-hidden="true" />
        </button>
        <div className="avatar" aria-label="Current user">
          A
        </div>
        <button className="icon-button" aria-label="App menu" type="button" disabled>
          <Grip size={16} aria-hidden="true" />
        </button>
      </div>
    </header>
  )
}
