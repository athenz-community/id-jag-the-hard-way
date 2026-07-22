export type GenAIAdministratorRole =
  | "cost-accountable-admins"
  | "gen-ai-users-managers"

export type GenAIManagedRole =
  | "gen-ai-users-managers"
  | "gen-ai-users-manager"
  | "gen-ai-users"

export type GenAIAdministratorResponsibility = {
  manageUrl: string
  managedRole: GenAIManagedRole
  members: string[]
  role: GenAIAdministratorRole
}

export type CostAccountableDomain = {
  domain: string
  responsibilities: GenAIAdministratorResponsibility[]
  service: string
}
