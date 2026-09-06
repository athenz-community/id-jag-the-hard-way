import assert from "node:assert/strict"
import test from "node:test"
import { deploymentRuntimeStatus } from "../features/catalog/api/kubernetesCatalog.ts"

test("reports an observed and ready MCP deployment as active", () => {
  assert.deepEqual(deploymentRuntimeStatus({
    metadata: { generation: 3 },
    spec: { replicas: 1 },
    status: {
      availableReplicas: 1,
      observedGeneration: 3,
      readyReplicas: 1,
      updatedReplicas: 1,
    },
  }), {
    status: "active",
    message: "The MCP deployment is available.",
  })
})

test("reports a new MCP deployment as in progress while readiness is pending", () => {
  assert.deepEqual(deploymentRuntimeStatus({
    metadata: { generation: 1 },
    spec: { replicas: 1 },
    status: { observedGeneration: 1, updatedReplicas: 1 },
  }), {
    status: "in-progress",
    message: "Waiting for the MCP deployment and protocol readiness check.",
  })
})

test("reports a failed MCP rollout as unhealthy", () => {
  assert.deepEqual(deploymentRuntimeStatus({
    metadata: { generation: 1 },
    spec: { replicas: 1 },
    status: {
      conditions: [{
        message: "MCP container could not be created",
        status: "True",
        type: "ReplicaFailure",
      }],
      observedGeneration: 1,
    },
  }), {
    status: "unhealthy",
    message: "MCP container could not be created",
  })
})
