import assert from "node:assert/strict"
import test from "node:test"
import {
  identitySecretPatch,
  serviceCertificateCommandArguments,
  serviceIdentityConfigFromEnvironment,
} from "../src/identity.ts"

const environment = {
  ATHENZ_SERVICE_DOMAIN: "mcp-hub.mcps.k8s-docs-server",
  ATHENZ_SERVICE_NAME: "runtime",
  KUBERNETES_IDENTITY_SECRET_NAME: "docs-mcp-athenz-identity",
  KUBERNETES_SERVICE_HOST: "kubernetes.default.svc",
  POD_NAME: "docs-mcp-abc123",
  POD_NAMESPACE: "k8s-docs-server",
}

test("loads the managed service identity configuration with a 24-hour refresh", () => {
  const config = serviceIdentityConfigFromEnvironment(environment)
  assert.ok(config)
  assert.equal(config.refreshSeconds, 86_400)
  assert.equal(config.retrySeconds, 300)
  assert.equal(config.keyId, "idthw-hub-generated")
  assert.equal(config.serviceDomain, "mcp-hub.mcps.k8s-docs-server")
  assert.equal(config.serviceName, "runtime")
})

test("keeps service identity rotation disabled when no identity is configured", () => {
  assert.equal(serviceIdentityConfigFromEnvironment({}), undefined)
  assert.throws(
    () => serviceIdentityConfigFromEnvironment({ ATHENZ_SERVICE_DOMAIN: "example" }),
    /must be configured together/,
  )
})

test("builds a zts-svccert request for the Hub-generated service key", () => {
  const config = serviceIdentityConfigFromEnvironment(environment)
  assert.ok(config)
  const args = serviceCertificateCommandArguments(config, "/tmp/service.cert.pem")
  assert.deepEqual(args.slice(0, 6), [
    "-zts",
    "https://athenz-zts-server.athenz:4443/zts/v1",
    "-domain",
    "mcp-hub.mcps.k8s-docs-server",
    "-service",
    "runtime",
  ])
  assert.equal(args[args.indexOf("-key-version") + 1], "idthw-hub-generated")
  assert.equal(args[args.indexOf("-cacert") + 1], "/var/run/athenz/ca.crt")
})

test("encodes the refreshed certificate and key for a Kubernetes Secret patch", () => {
  const patch = identitySecretPatch("test-certificate", "test-private-key")
  assert.deepEqual(patch, {
    data: {
      "service.cert.pem": Buffer.from("test-certificate").toString("base64"),
      "service.key.pem": Buffer.from("test-private-key").toString("base64"),
    },
  })
})
