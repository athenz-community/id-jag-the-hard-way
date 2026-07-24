export type HubAccountSummary = {
  subject: string
  username: string
  name?: string
  email?: string
  image?: string
}

export type CachedHubAccount = HubAccountSummary & {
  idToken: string
  idTokenExpiresAt?: number
  refreshToken?: string
  refreshTokenExpiresAt?: number
}
