"use client"

import type { ReactNode } from "react"
import { useState } from "react"
import { ClientConfiguration } from "@/components/molecules/ClientConfiguration"
import {
  managedMcpAccessIsApproved,
  McpAccessRequestSection,
} from "@/features/permissions/components/McpAccessRequestSection"
import type { PermissionReadiness } from "@/features/permissions/types/permissions"
import { managedMcpAccessScope } from "@/features/registration/lib/kubernetesManifest"

export function McpManagedClientConfiguration({
  currentAccessScope,
  displayName,
  mcpKeyName,
  mcpServerUrl,
  permissionCheck,
  project,
  readiness,
  serverName,
  username,
}: {
  currentAccessScope?: string
  displayName: string
  mcpKeyName: string
  mcpServerUrl: string
  permissionCheck: ReactNode
  project: string
  readiness: PermissionReadiness | null
  serverName: string
  username: string
}) {
  const expectedAccessScope = managedMcpAccessScope(project, mcpKeyName)
  const [accessApproved, setAccessApproved] = useState(() => managedMcpAccessIsApproved(
    currentAccessScope,
    expectedAccessScope,
    readiness,
  ))

  return (
    <ClientConfiguration
      accessRequest={(
        <McpAccessRequestSection
          currentAccessScope={currentAccessScope}
          displayName={displayName}
          mcpKeyName={mcpKeyName}
          onApproved={() => setAccessApproved(true)}
          project={project}
          readiness={readiness}
          username={username}
        />
      )}
      configurationStepNumber={3}
      followingStepsVisible={accessApproved}
      mcpServerUrl={mcpServerUrl}
      permissionCheck={permissionCheck}
      serverName={serverName}
    />
  )
}
