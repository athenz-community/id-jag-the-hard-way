import type { Metadata } from "next"
import "./globals.css"

export const metadata: Metadata = {
  title: "MCP Hub",
  description: "Mock MCP Hub catalog for ID-JAG",
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
