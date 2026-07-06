import Image from "next/image"
import type { CSSProperties } from "react"
import type { McpServer } from "@/features/catalog/types/catalog"

export function ServerLogo({ server }: { server: McpServer }) {
  return (
    <div
      className={`server-logo ${server.iconSrc ? "image-logo" : "text-logo"}`}
      style={
        {
          "--logo-bg": server.logoBg,
          "--logo-fg": server.logoFg,
        } as CSSProperties
      }
    >
      {server.iconSrc ? <Image src={server.iconSrc} alt="" width={24} height={24} className="server-logo-image" /> : server.logoText}
    </div>
  )
}
