# Goal

Test role self-service in `api.test-self-service` with `user.athenz_admin` as the UI requester and `human.idjag-learner` as the domain administrator, from a rejected join request to pending and approved membership. Verify the requester's status in the Self Service UI and the discovery API added by #3487.

> [!NOTE]
> Note that the Athenz's feature `Self Renewal` and `Self Service` are different things

<!-- TOC depthFrom:2 depthTo:2 -->

- [Step 1. Create the test subdomain and assign the learner as admin](#step-1-create-the-test-subdomain-and-assign-the-learner-as-admin)
- [Step 2. Create a normal role as the learner admin](#step-2-create-a-normal-role-as-the-learner-admin)
- [Step 3. Try to join as the UI user](#step-3-try-to-join-as-the-ui-user)
- [Step 4. Enable self-service as the learner admin](#step-4-enable-self-service-as-the-learner-admin)
- [Step 5. Request membership as the UI user](#step-5-request-membership-as-the-ui-user)
- [Step 6. Try to self-approve as the UI user](#step-6-try-to-self-approve-as-the-ui-user)
- [Step 7. Approve as the learner admin and confirm in the UI](#step-7-approve-as-the-learner-admin-and-confirm-in-the-ui)
- [Step 8. Discover self-service roles and check membership](#step-8-discover-self-service-roles-and-check-membership)
- [Clean-up 9. Delete the test role and restore the original admin](#clean-up-9-delete-the-test-role-and-restore-the-original-admin)

<!-- /TOC -->

<details>
<summary>Last human verified on Oct 23, 2026 — 🟡 Partially verified</summary>

The revised flow makes `human.idjag-learner` the domain administrator and uses `user.athenz_admin` as the requester so its membership appears in the UI. This administrator handover and UI flow are pending human verification. Steps 2 and 4 retain the exact role GET responses captured before the handover; the earlier responses below are from `api.test-self-renew`.

| # | Date | Confirmed Working |
|---|---|---|
| 1 | Oct 23, 2026 | ✅ |

**Earlier setup: `self-service-test`**

```sh
_self_service_zms_port=$(./tools/port.sh zms) &&
curl -skS --fail-with-body \
  --cert ./athenz_dist/certs/athenz_admin.cert.pem \
  --key ./athenz_dist/keys/athenz_admin.private.pem \
  "https://localhost:${_self_service_zms_port}/zms/v1/domain/api.test-self-renew/role/self-service-test" \
  | jq
```

```sh
# Captured from the user's run — Oct 23, 2026
# {
#   "selfServe": true,
#   "name": "api.test-self-renew:role.self-service-test",
#   "modified": "2026-10-23T00:21:25.105Z"
# }
```

**Earlier Step 2: normal role before enabling self-service**

```sh
# Captured from the user's run — Oct 23, 2026
# {
#   "name": "api.test-self-renew:role.self-service-flow-test",
#   "modified": "2026-10-23T00:33:12.487Z"
# }
```

**Earlier Step 4: role after enabling self-service**

```sh
# Captured from the user's run — Oct 23, 2026
# {
#   "selfServe": true,
#   "name": "api.test-self-renew:role.self-service-flow-test",
#   "modified": "2026-10-23T00:34:37.682Z"
# }
```

**Earlier Step 5: learner membership request**

```sh
# Captured from the user's run — Oct 23, 2026
# {
#   "memberName": "human.idjag-learner",
#   "isMember": true,
#   "roleName": "api.test-self-renew:role.self-service-flow-test",
#   "approved": false,
#   "requestPrincipal": "human.idjag-learner",
#   "pendingState": "ADD"
# }
```

</details>

# Prerequisites

This tutorial requires the following to be completed:

1. Complete the main [ID-JAG The Hard Way tutorial](https://github.com/mlajkim/id-jag-the-hard-way/tree/main/tutorials), including the `api` domain and local administrator setup

Run all commands from the ID-JAG The Hard Way repository root (`idthw/`). This procedure uses two existing principals:

| Principal | Purpose in this test | Certificate and key |
|---|---|---|
| `human.idjag-learner` | Domain administrator: creates the role, enables self-service, and approves requests | `./keys/idjag-learner.crt`, `./keys/idjag-learner.key` |
| `user.athenz_admin` | UI user: requests membership and checks its own status | `./athenz_dist/certs/athenz_admin.cert.pem`, `./athenz_dist/keys/athenz_admin.private.pem` |

The learner remains the service principal created in the main tutorial. Step 1 grants it the test domain's `admin` role and removes `user.athenz_admin` from that role. Despite its name, `user.athenz_admin` must then have no `update` or `update_members` permission on the test role. The UI's **My Roles & Groups** view follows the signed-in principal, so use `user.athenz_admin` there to see the requests made with its certificate.

JSON responses are displayed in full with plain `jq`. Commands that return no body use `--include` to display the HTTP status and all response headers. Their examples show only the HTTP/1.1 status line; the protocol and headers can vary. Captured results are labeled; other result blocks are expected examples based on v1.12.48, with changing timestamps omitted.

# Steps

Here is the procedure to get to the goals.

## Step 1. Create the test subdomain and assign the learner as admin

Start a new run by creating `test-self-service` under the existing `api` domain as `user.athenz_admin`:

```sh
./tools/athenz/create-subdomain.sh api test-self-service
```

```sh
# Expected creation log for a new subdomain — not captured
#   ·  Creating Subdomain: api.test-self-service...
#   ✔  Subdomain created: api.test-self-service
```

If the subdomain already exists, the helper reports `Subdomain already exists: api.test-self-service` and leaves it in place.

While `user.athenz_admin` still manages the subdomain, add `human.idjag-learner` to its `admin` role:

```sh
./tools/athenz/add-role-member.sh \
  api.test-self-service \
  admin \
  human.idjag-learner
```

```sh
#   ·  Adding Member human.idjag-learner to Role: api.test-self-service:role.admin...
#   ✔  human.idjag-learner  →  api.test-self-service:role.admin
```

Use the learner's certificate to confirm it can manage the domain's admin role. Continue with the removal only when `granted` is `true`:

```sh
_self_service_zms_port=$(./tools/port.sh zms) &&
curl -skS --fail-with-body \
  --cert ./keys/idjag-learner.crt \
  --key ./keys/idjag-learner.key \
  "https://localhost:${_self_service_zms_port}/zms/v1/access/update/api.test-self-service:role.admin" \
  | jq
```

```sh
# {
#   "granted": true
# }
```

Use the existing helper as `user.athenz_admin` to remove its own membership from `api.test-self-service:role.admin`. The learner's admin access has already been confirmed, so the domain retains an administrator:

```sh
./tools/athenz/delete-role-member.sh \
  api.test-self-service \
  admin \
  user.athenz_admin
```

```sh
#   ·  Deleting member user.athenz_admin from role api.test-self-service:role.admin...
#   ✔  Role member deleted or already absent: user.athenz_admin  →  api.test-self-service:role.admin
```

The learner now manages the test domain. Keep the UI signed in as `user.athenz_admin` for the membership request and status checks.

## Step 2. Create a normal role as the learner admin

Self-service and self-renewal control different membership operations:

| Setting | Purpose |
|---|---|
| `selfServe=true` | An authenticated principal can request role membership; a request from a caller without membership-management permission needs approval |
| `selfRenew=true` with a positive `selfRenewMins` | An existing member can renew its membership, including an expired membership, for the configured duration |

These settings are independent. This test enables only `selfServe`; [self-renewal research](../membership-self-renewal/260814-check-zms-self-renew-validation.md) covers renewal-setting validation.

Create `self-service-flow-test` with self-service disabled, using the learner's certificate. The `create-role.sh` helper uses `user.athenz_admin`, so this step calls ZMS directly with the new domain administrator:

```sh
_self_service_zms_port=$(./tools/port.sh zms) &&
curl -skS --fail-with-body --include \
  --cert ./keys/idjag-learner.crt \
  --key ./keys/idjag-learner.key \
  -X PUT \
  -H 'Content-Type: application/json' \
  -H 'Y-Audit-Ref: create self-service test role' \
  --data '{"name":"api.test-self-service:role.self-service-flow-test","selfServe":false}' \
  "https://localhost:${_self_service_zms_port}/zms/v1/domain/api.test-self-service/role/self-service-flow-test"
```

```sh
# HTTP/1.1 204 No Content
```

As the learner admin, read the full role, including any pending members, to confirm the starting state:

```sh
_self_service_zms_port=$(./tools/port.sh zms) &&
curl -skS --fail-with-body \
  --cert ./keys/idjag-learner.crt \
  --key ./keys/idjag-learner.key \
  "https://localhost:${_self_service_zms_port}/zms/v1/domain/api.test-self-service/role/self-service-flow-test?pending=true" \
  | jq
```

```sh
# Captured before the administrator handover — Oct 23, 2026
# {
#   "name": "api.test-self-service:role.self-service-flow-test",
#   "modified": "2026-10-23T00:50:30.605Z"
# }
```

The captured response shows the required starting state: omitted `selfServe` defaults to `false`, and `roleMembers` is absent even with `pending=true`, meaning there are no current or pending members. That query parameter only includes pending members in the response; it does not enable self-service. `modified` is the role's last-change timestamp in UTC. Step 3 tests the UI user's request against this state.

## Step 3. Try to join as the UI user

Authenticate as `user.athenz_admin` and request its own membership. It no longer manages this domain, and the role still has self-service disabled, so ZMS should reject the request.

Use the `athenz_admin` certificate here to match the principal signed in to the UI:

```sh
_self_service_zms_port=$(./tools/port.sh zms) &&
curl -skS --fail-with-body \
  --cert ./athenz_dist/certs/athenz_admin.cert.pem \
  --key ./athenz_dist/keys/athenz_admin.private.pem \
  -X PUT \
  -H 'Content-Type: application/json' \
  -H 'Athenz-Return-Object: true' \
  -H 'Y-Audit-Ref: self-service UI user request' \
  --data '{"memberName":"user.athenz_admin","roleName":"self-service-flow-test"}' \
  "https://localhost:${_self_service_zms_port}/zms/v1/domain/api.test-self-service/role/self-service-flow-test/member/user.athenz_admin" \
  | jq
```

```sh
# Expected from v1.12.48 source — not captured
# curl: (22) The requested URL returned error: 403
# {
#   "code": 403,
#   "message": "putMembership: principal is not authorized to add members"
# }
```

This specific 403 is the intended result. A certificate/authentication error does not verify self-service behavior. If the request succeeds here, check the role settings and `user.athenz_admin`'s remaining permissions in the test domain before continuing.

## Step 4. Enable self-service as the learner admin

Switch to the learner's certificate and enable `selfServe` through the role metadata endpoint. `--include` displays the HTTP status and response headers because a successful update returns no body:

```sh
_self_service_zms_port=$(./tools/port.sh zms) &&
curl -skS --fail-with-body --include \
  --cert ./keys/idjag-learner.crt \
  --key ./keys/idjag-learner.key \
  -X PUT \
  -H 'Content-Type: application/json' \
  -H 'Y-Audit-Ref: enable role self-service' \
  --data '{"selfServe":true}' \
  "https://localhost:${_self_service_zms_port}/zms/v1/domain/api.test-self-service/role/self-service-flow-test/meta"
```

```sh
# HTTP/1.1 204 No Content
```

Read the role back as the learner admin:

```sh
_self_service_zms_port=$(./tools/port.sh zms) &&
curl -skS --fail-with-body \
  --cert ./keys/idjag-learner.crt \
  --key ./keys/idjag-learner.key \
  "https://localhost:${_self_service_zms_port}/zms/v1/domain/api.test-self-service/role/self-service-flow-test" \
  | jq
```

```sh
# Captured before the administrator handover — Oct 23, 2026
# {
#   "selfServe": true,
#   "name": "api.test-self-service:role.self-service-flow-test",
#   "modified": "2026-10-23T00:51:03.962Z"
# }
```

Enabling self-service allows membership requests; it does not add `user.athenz_admin`. In the UI, **Self Service → Find Roles & Groups** should now find `self-service-flow-test` in `api.test-self-service`.

## Step 5. Request membership as the UI user

Repeat the same request from Step 3 with the `athenz_admin` certificate. `Athenz-Return-Object: true` asks ZMS to return the stored membership object:

```sh
_self_service_zms_port=$(./tools/port.sh zms) &&
curl -skS --fail-with-body \
  --cert ./athenz_dist/certs/athenz_admin.cert.pem \
  --key ./athenz_dist/keys/athenz_admin.private.pem \
  -X PUT \
  -H 'Content-Type: application/json' \
  -H 'Athenz-Return-Object: true' \
  -H 'Y-Audit-Ref: self-service UI user request' \
  --data '{"memberName":"user.athenz_admin","roleName":"self-service-flow-test"}' \
  "https://localhost:${_self_service_zms_port}/zms/v1/domain/api.test-self-service/role/self-service-flow-test/member/user.athenz_admin" \
  | jq
```

```sh
# {
#   "memberName": "user.athenz_admin",
#   "isMember": true,
#   "roleName": "api.test-self-service:role.self-service-flow-test",
#   "approved": false,
#   "requestPrincipal": "user.athenz_admin",
#   "pendingState": "ADD"
# }
```

A successful request remains pending approval: `approved=false` and `pendingState="ADD"`. The v1.12.48 JDBC store can return `isMember=true` for a pending record. It does not mean the membership is approved or active.

As the learner admin, read the role with `pending=true` to include the pending member:

```sh
_self_service_zms_port=$(./tools/port.sh zms) &&
curl -skS --fail-with-body \
  --cert ./keys/idjag-learner.crt \
  --key ./keys/idjag-learner.key \
  "https://localhost:${_self_service_zms_port}/zms/v1/domain/api.test-self-service/role/self-service-flow-test?pending=true" \
  | jq
```

```sh
# {
#   "selfServe": true,
#   "name": "api.test-self-service:role.self-service-flow-test",
#   "roleMembers": [
#     {
#       "memberName": "user.athenz_admin",
#       "active": false,
#       "approved": false,
#       "auditRef": "self-service UI user request",
#       "pendingState": "ADD"
#     }
#   ]
# }
```

Open the Self Service UI as `user.athenz_admin`:

```sh
_self_service_ui_port=$(./tools/port.sh athenz-ui) &&
./tools/open.sh "http://localhost:${_self_service_ui_port}/self-service"
```

```sh
#   ✔  Opened: http://localhost:3000/self-service
```

The example uses the default UI port, 3000. Refresh **My Roles & Groups** and look under **Pending requests** for `api.test-self-service` / `self-service-flow-test`. A pending request can appear while the membership count is still 0; the count covers approved memberships.

## Step 6. Try to self-approve as the UI user

Try to approve `user.athenz_admin`'s own pending request, using the same certificate as the requester:

```sh
_self_service_zms_port=$(./tools/port.sh zms) &&
curl -skS --fail-with-body \
  --cert ./athenz_dist/certs/athenz_admin.cert.pem \
  --key ./athenz_dist/keys/athenz_admin.private.pem \
  -X PUT \
  -H 'Content-Type: application/json' \
  -H 'Y-Audit-Ref: UI user self-service approval attempt' \
  --data '{"memberName":"user.athenz_admin","roleName":"self-service-flow-test","approved":true,"active":true}' \
  "https://localhost:${_self_service_zms_port}/zms/v1/domain/api.test-self-service/role/self-service-flow-test/member/user.athenz_admin/decision" \
  | jq
```

```sh
# Expected from v1.12.48 source — not captured
# curl: (22) The requested URL returned error: 403
# {
#   "code": 403,
#   "message": "principal user.athenz_admin is not authorized to approve / reject members"
# }
```

This 403 is expected because `user.athenz_admin` has no `update` or `update_members` permission on the role after Step 1. `selfServe` allows submitting a membership request but does not grant approval permission. The rejected approval attempt leaves the request pending; continue to Step 7 as the learner admin.

## Step 7. Approve as the learner admin and confirm in the UI

As `human.idjag-learner`, approve the pending request for `user.athenz_admin` and activate its membership:

```sh
_self_service_zms_port=$(./tools/port.sh zms) &&
curl -skS --fail-with-body --include \
  --cert ./keys/idjag-learner.crt \
  --key ./keys/idjag-learner.key \
  -X PUT \
  -H 'Content-Type: application/json' \
  -H 'Y-Audit-Ref: approve self-service membership' \
  --data '{"memberName":"user.athenz_admin","roleName":"self-service-flow-test","approved":true,"active":true}' \
  "https://localhost:${_self_service_zms_port}/zms/v1/domain/api.test-self-service/role/self-service-flow-test/member/user.athenz_admin/decision"
```

```sh
# HTTP/1.1 204 No Content
```

As `user.athenz_admin`, read the role. It should now include the approved member:

```sh
_self_service_zms_port=$(./tools/port.sh zms) &&
curl -skS --fail-with-body \
  --cert ./athenz_dist/certs/athenz_admin.cert.pem \
  --key ./athenz_dist/keys/athenz_admin.private.pem \
  "https://localhost:${_self_service_zms_port}/zms/v1/domain/api.test-self-service/role/self-service-flow-test" \
  | jq
```

```sh
# {
#   "selfServe": true,
#   "name": "api.test-self-service:role.self-service-flow-test",
#   "roleMembers": [
#     {
#       "memberName": "user.athenz_admin",
#       "approved": true,
#       "auditRef": "approve self-service membership",
#       "requestPrincipal": "user.athenz_admin"
#     }
#   ]
# }
```

`approved=true` confirms approval. Omitted `active` defaults to `true`, and `pendingState="ADD"` is gone. The expected progression is rejection → pending request → approved, active membership. Access to protected resources still depends on policies referencing this role.

Refresh **Self Service → My Roles & Groups** while still signed in as `user.athenz_admin`. The test role should now appear under **Roles** and disappear from **Pending requests**. If this is the account's only self-service membership, the UI shows 1 membership and 0 requests awaiting approval.

## Step 8. Discover self-service roles and check membership

[#3487](https://github.com/AthenZ/athenz/pull/3487) adds APIs for discovering self-service roles across domains and finding the caller's own memberships or pending requests. The membership request and approval operations in the preceding steps already existed; this step tests the new role discovery endpoint, `GET /zms/v1/selfserve/role`.

As `user.athenz_admin`, search for the test role by name. `matchString` searches role names and descriptions without requiring the caller to specify a domain. The examples show this run's entry with the default settings and no domain membership expiry; matching roles from other domains may also appear. Identify this run by `domainName="api.test-self-service"`:

```sh
_self_service_zms_port=$(./tools/port.sh zms) &&
curl -skS --fail-with-body \
  --cert ./athenz_dist/certs/athenz_admin.cert.pem \
  --key ./athenz_dist/keys/athenz_admin.private.pem \
  "https://localhost:${_self_service_zms_port}/zms/v1/selfserve/role?matchString=self-service-flow-test&memberOnly=false" \
  | jq
```

```sh
# {
#   "list": [
#     {
#       "domainName": "api.test-self-service",
#       "name": "self-service-flow-test",
#       "selfRenew": false,
#       "selfRenewMins": 0,
#       "reviewEnabled": false,
#       "auditEnabled": false,
#       "deleteProtection": false,
#       "memberStatus": "none",
#       "memberExpiryDays": 0,
#       "domainMemberExpiryDays": 0
#     }
#   ]
# }
```

In the final v1.12.48 implementation, [#3500](https://github.com/AthenZ/athenz/pull/3500) separates catalog queries from membership queries. Both modes select self-service roles:

| Query | What it returns |
|---|---|
| `memberOnly=false` or omitted | Matching role metadata; `memberStatus="none"` means membership was not loaded |
| `memberOnly=true` | Matching roles where the authenticated caller has a membership or pending request, with that caller's status |

Use `memberOnly=true` to check the UI user's membership. Keep the `athenz_admin` certificate so the API queries the same principal as **My Roles & Groups**. The learner's certificate would query `human.idjag-learner`'s memberships:

```sh
_self_service_zms_port=$(./tools/port.sh zms) &&
curl -skS --fail-with-body \
  --cert ./athenz_dist/certs/athenz_admin.cert.pem \
  --key ./athenz_dist/keys/athenz_admin.private.pem \
  "https://localhost:${_self_service_zms_port}/zms/v1/selfserve/role?matchString=self-service-flow-test&memberOnly=true" \
  | jq
```

```sh
# {
#   "list": [
#     {
#       "domainName": "api.test-self-service",
#       "name": "self-service-flow-test",
#       "selfRenew": false,
#       "selfRenewMins": 0,
#       "reviewEnabled": false,
#       "auditEnabled": false,
#       "deleteProtection": false,
#       "memberStatus": "member",
#       "memberExpiryDays": 0,
#       "domainMemberExpiryDays": 0
#     }
#   ]
# }
```

This membership query can also be run before Step 7: while `user.athenz_admin`'s request is pending, expect `memberStatus="pending"`. Before any membership request, the role is absent from this caller's membership results. The catalog's `memberStatus="none"` does not establish whether the UI user is a member.

## Clean-up 9. Delete the test role and restore the original admin

After completing the API and UI checks, delete the test role and its membership as the learner admin:

```sh
_self_service_zms_port=$(./tools/port.sh zms) &&
curl -skS --fail-with-body --include \
  --cert ./keys/idjag-learner.crt \
  --key ./keys/idjag-learner.key \
  -X DELETE \
  -H 'Y-Audit-Ref: clean up self-service test role' \
  "https://localhost:${_self_service_zms_port}/zms/v1/domain/api.test-self-service/role/self-service-flow-test"
```

```sh
# HTTP/1.1 204 No Content
```

Still as the learner, restore `user.athenz_admin` to the test domain's `admin` role:

```sh
_self_service_zms_port=$(./tools/port.sh zms) &&
curl -skS --fail-with-body \
  --cert ./keys/idjag-learner.crt \
  --key ./keys/idjag-learner.key \
  -X PUT \
  -H 'Content-Type: application/json' \
  -H 'Athenz-Return-Object: true' \
  -H 'Y-Audit-Ref: restore original test domain admin' \
  --data '{"memberName":"user.athenz_admin","roleName":"admin"}' \
  "https://localhost:${_self_service_zms_port}/zms/v1/domain/api.test-self-service/role/admin/member/user.athenz_admin" \
  | jq
```

```sh
# {
#   "memberName": "user.athenz_admin",
#   "isMember": true,
#   "roleName": "api.test-self-service:role.admin",
#   "approved": true,
#   "requestPrincipal": "human.idjag-learner"
# }
```

After confirming the restored membership is approved, use the original administrator's helper to remove the learner's temporary admin membership:

```sh
./tools/athenz/delete-role-member.sh \
  api.test-self-service \
  admin \
  human.idjag-learner
```

```sh
#   ·  Deleting member human.idjag-learner from role api.test-self-service:role.admin...
#   ✔  Role member deleted or already absent: human.idjag-learner  →  api.test-self-service:role.admin
```

# Reference

- [#3487 — Add self-service API endpoints and update clients](https://github.com/AthenZ/athenz/pull/3487)
- [#3500 — Simplify the self-service API implementation](https://github.com/AthenZ/athenz/pull/3500)
- [#3489 — Add the Self Service UI](https://github.com/AthenZ/athenz/pull/3489)
- [Athenz v1.12.48 access-check API](https://github.com/AthenZ/athenz/blob/v1.12.48/core/zms/src/main/rdl/Access.rdli)
- [Self Service UI membership and pending-request views](https://github.com/AthenZ/athenz/blob/v1.12.48/ui/src/components/self-service/SelfServiceView.js)
- [Athenz v1.12.48 self-service discovery API](https://github.com/AthenZ/athenz/blob/v1.12.48/core/zms/src/main/rdl/SelfServe.rdli)
- [Athenz v1.12.48 role settings and membership fields](https://github.com/AthenZ/athenz/blob/v1.12.48/core/zms/src/main/rdl/Role.tdl)
- [Role, membership, metadata, and approval APIs](https://github.com/AthenZ/athenz/blob/v1.12.48/core/zms/src/main/rdl/Role.rdli)
- [Membership authorization and self-service pending state](https://github.com/AthenZ/athenz/blob/v1.12.48/servers/zms/src/main/java/com/yahoo/athenz/zms/ZMSImpl.java#L11276-L11314)
- [Membership approval authorization](https://github.com/AthenZ/athenz/blob/v1.12.48/servers/zms/src/main/java/com/yahoo/athenz/zms/ZMSImpl.java#L11076-L11124)
- [Pending membership storage and returned object](https://github.com/AthenZ/athenz/blob/v1.12.48/servers/zms/src/main/java/com/yahoo/athenz/zms/DBService.java#L2174-L2245)
- [JDBC membership lookup, including pending records](https://github.com/AthenZ/athenz/blob/v1.12.48/libs/java/server_common/src/main/java/com/yahoo/athenz/common/server/store/impl/JDBCConnection.java#L2670-L2744)
