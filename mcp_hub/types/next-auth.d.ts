import type { DefaultSession } from "next-auth"
import type { CachedHubAccount, HubAccountSummary } from "@/features/auth/types/accounts"

declare module "next-auth" {
  interface Session {
    idToken?: string
    accounts: HubAccountSummary[]
    activeSubject?: string
    user: DefaultSession["user"] & {
      username?: string
      subject?: string
    }
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    idToken?: string
    idTokenExpiresAt?: number
    username?: string
    subject?: string
    refreshToken?: string
    refreshTokenExpiresAt?: number
    cachedAccounts?: CachedHubAccount[]
  }
}
