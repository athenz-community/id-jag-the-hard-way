# athenzd — Use Cases

## 1. Developer Laptop (core)

**`brew install athenzd`**

1. Installs athenzd, with a configuration file for internal/external usages

**`athenzd login`**

1. Logs in into IdP via browser
1. Caches ID token for the logged in *user*
1. Ensures the `home.<*user*>` domain, its `local` subdomain, and the `athenzd` service in that subdomain exist in **ZMS**, creating them if missing.
   - athenzd calls ZMS with the ID token as the credential; ZMS's `OIDCAuthority` authenticates the caller as `user.<*user*>`.
   - The user self-creates their own `home.<*user*>` domain, the `home.<*user*>.local` subdomain, and the `athenzd` service inside that subdomain.
   - Note: this is a **ZMS** operation. Copper Argos (`POST /instance` on ZTS) does **not** create domains/services — it only issues X.509 certs, and requires the service to already exist. Cert issuance (via ID-token attestation) is a **later** step.

### Prerequisites

- An IdP with an `athenzd` client registered. To set up: [here](../faqs/athenzd_local_test_guide/01-log-in-and-inspect-id-token.md)
- ZMS is configured to authenticate the IdP token with `OIDCJwtAuthority`. To set up and test the ensure flow: [here](../faqs/athenzd_local_test_guide/02-ensure-home-domain-and-service-with-id-token.md)
- ZMS has `athenz.home_domain=home`; ZMS creates the reserved `home` top-level domain during initial system setup.

### Constraints

- User certs are short-lived, about 12h. They are good for user-driven local flows, not unattended long-running identity.
- Refreshing the ID token requires human input through browser login. If it expires, `athenzd` should ask the user to log in again.
- Copper Argos / `home.<user>.local.athenzd` service cert can come later for background renewal without repeated human input.
