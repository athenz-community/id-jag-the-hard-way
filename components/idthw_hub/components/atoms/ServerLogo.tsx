import Image from "next/image"
import type { CSSProperties } from "react"
import type { McpServer } from "@/features/catalog/types/catalog"

export function ServerLogo({ server }: { server: McpServer }) {
  return (
    <McpResourceLogo
      iconSrc={server.iconSrc}
      logoBg={server.logoBg}
      logoFg={server.logoFg}
      logoText={server.logoText}
    />
  )
}

export function McpResourceLogo({
  iconSrc,
  logoBg = "#ffffff",
  logoFg = "#111111",
  logoText,
}: {
  iconSrc?: string
  logoBg?: string
  logoFg?: string
  logoText: string
}) {
  return (
    <div
      className={`server-logo ${iconSrc ? "image-logo" : "text-logo"}`}
      style={
        {
          "--logo-bg": logoBg,
          "--logo-fg": logoFg,
        } as CSSProperties
      }
    >
      {iconSrc ? <Image src={iconSrc} alt="" width={24} height={24} className="server-logo-image" /> : logoText}
    </div>
  )
}
