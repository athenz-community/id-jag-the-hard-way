import type { Metadata } from "next"
import "./globals.css"

export const metadata: Metadata = {
  title: "IDTHW Hub",
  description: "IDTHW console for MCP, Gen AI, and ID-JAG",
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
