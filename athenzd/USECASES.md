# athenzd — Use Cases

## 1. Developer Laptop (core)

**`brew install athenzd`**

1. Installs athenzd, with a configuration file for internal/external usages

**`athenzd login`**

1. Logs in into IdP via browser
1. Caches ID token for the logged in *user*
1. Requires the personal parent `home.<*user*>`, then ensures its `local` child domain and the `athenzd` service exist in **ZMS**, creating only those child resources when missing.
   - athenzd calls ZMS with the ID token as the credential; ZMS's `OIDCJwtAuthority` authenticates the caller as `user.<*user*>`.
   - The configured Go template `home.{{.preferred_username}}.local.athenzd` is the complete service identity. It is rendered from the fresh ID token and parsed into the required parent, child domain, and simple service name.
   - athenzd never creates the reserved `home` top-level domain or the `home.<*user*>` personal parent. If the personal parent is absent, login returns a prerequisite error.
   - Note: this is a **ZMS** operation. Copper Argos (`POST /instance` on ZTS) does **not** create domains/services — it only issues X.509 certs, and requires the service to already exist. Cert issuance (via ID-token attestation) is a **later** step.

### Prerequisites

- An IdP with an `athenzd` client registered. For the IDTHW environment, follow [Test `athenzd` with IDTHW](../faqs/athenzd/test-athenzd-with-idthw.md).
- ZMS is configured to authenticate the IdP token with `OIDCJwtAuthority` as described in the same local test guide.
- ZMS has `athenz.home_domain=home`; ZMS creates the reserved `home` top-level domain during initial system setup.
- The user's `home.<user>` personal parent domain has already been provisioned outside athenzd.

### Constraints

- User certs are short-lived, about 12h. They are good for user-driven local flows, not unattended long-running identity.
- Refreshing the ID token requires human input through browser login. If it expires, `athenzd` should ask the user to log in again.
- Copper Argos / `home.<user>.local.athenzd` service cert can come later for background renewal without repeated human input.
