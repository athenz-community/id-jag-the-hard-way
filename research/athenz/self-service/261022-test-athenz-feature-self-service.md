# Goal

Verify role self-service with `human.idjag-learner`: reject its membership request on a normal role, enable `selfServe`, and confirm that the request needs administrator approval before the membership becomes active.

> [!NOTE]
> Note that the Athenz's feature `Self Renewal` and `Self Service` are different things

<!-- TOC depthFrom:2 depthTo:2 -->

- [Step 1. Create the test subdomain](#step-1-create-the-test-subdomain)
- [Step 2. Create a normal role as admin](#step-2-create-a-normal-role-as-admin)
- [Step 3. Try to join as the learner](#step-3-try-to-join-as-the-learner)
- [Step 4. Enable self-service as admin](#step-4-enable-self-service-as-admin)
- [Step 5. Request membership as the learner](#step-5-request-membership-as-the-learner)
- [Step 6. Try to approve as the learner](#step-6-try-to-approve-as-the-learner)
- [Step 7. Approve as admin and confirm membership](#step-7-approve-as-admin-and-confirm-membership)
- [Clean-up 8. Delete the test role](#clean-up-8-delete-the-test-role)

<!-- /TOC -->

<details>
<summary>Last human verified on Oct 23, 2026 — 🟡 Partial verification</summary>

| # | Date | Confirmed Working |
|---|---|---|
| 1 | Oct 23, 2026 | 🟡 Settings and membership flow checked against v1.12.48 source; full flow not yet verified |
| 2 | Oct 23, 2026 | ✅ Human verified — full role GET response confirms `selfServe=true` for `api.test-self-renew:role.self-service-test` |
| 3 | Oct 23, 2026 | ✅ Human verified — Step 2 GET confirms `self-service-flow-test` exists with self-service disabled and no current or pending members |
| 4 | Oct 23, 2026 | ✅ Human verified — Step 4 GET confirms `selfServe=true` for `api.test-self-renew:role.self-service-flow-test` |
| 5 | Oct 23, 2026 | ✅ Human verified — Step 5 membership response for `human.idjag-learner` has `approved=false` and `pendingState="ADD"` |

The following is the earlier setup evidence. Steps 2 and 4 contain the captured role responses before and after enabling self-service; Step 5 contains the captured pending membership response. The disabled-role rejection, role views of the pending membership, learner approval rejection, admin approval, and cleanup results have not yet been captured.

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

</details>

# Prerequisites

This tutorial requires the following to be completed:

1. Complete the main [ID-JAG The Hard Way tutorial](https://github.com/mlajkim/id-jag-the-hard-way/tree/main/tutorials), including the `api` domain and local administrator setup
1. Complete [Create a learner identity](../../../tutorials/07-granular-permission.md#create-a-learner-identity), with a valid `./keys/idjag-learner.crt` and its existing `./keys/idjag-learner.key`
1. Keep `./tools/keep-k8s-port-forward.sh` running in another terminal

Run all commands from the ID-JAG The Hard Way repository root (`idthw/`). The tutorial models `human.idjag-learner` as a service principal; this test uses that identity. It must have no `update` or `update_members` permission on the test role.

The commands display the complete JSON response with plain `jq`. Metadata updates and membership approval return no response body on success; the following GET verifies the result. Uncaptured result blocks describe the expected checks; they are not live verification logs.

# Steps

Here is the procedure to get to the goals.

## Step 1. Create the test subdomain

As admin, create `test-self-renew` under the existing `api` domain:

```sh
./tools/athenz/create-subdomain.sh api test-self-renew
```

```sh
# Expected creation log for a new subdomain — not captured
#   ·  Creating Subdomain: api.test-self-renew...
#   ✔  Subdomain created: api.test-self-renew
```

If the subdomain already exists, the helper reports `Subdomain already exists: api.test-self-renew` and leaves it in place.

## Step 2. Create a normal role as admin

Self-service and self-renewal control different membership operations:

| Setting | Purpose |
|---|---|
| `selfServe=true` | An authenticated principal can request role membership; a request from a caller without membership-management permission needs approval |
| `selfRenew=true` with a positive `selfRenewMins` | An existing member can renew its membership, including an expired membership, for the configured duration |

These settings are independent. This test enables only `selfServe`; [self-renewal research](../membership-self-renewal/260814-check-zms-self-renew-validation.md) covers renewal-setting validation.

Create `self-service-flow-test` with self-service disabled:

```sh
./tools/athenz/create-role.sh \
  api.test-self-renew \
  self-service-flow-test
```

```sh
# Expected role creation log — not captured
#   ·  Creating Role: api.test-self-renew:role.self-service-flow-test...
#   ✔  Role created: api.test-self-renew:role.self-service-flow-test
```

As admin, read the full role, including any pending members, to confirm the starting state:

```sh
_self_service_zms_port=$(./tools/port.sh zms) &&
curl -skS --fail-with-body \
  --cert ./athenz_dist/certs/athenz_admin.cert.pem \
  --key ./athenz_dist/keys/athenz_admin.private.pem \
  "https://localhost:${_self_service_zms_port}/zms/v1/domain/api.test-self-renew/role/self-service-flow-test?pending=true" \
  | jq
```

```sh
# Captured from the user's run — Oct 23, 2026
# {
#   "name": "api.test-self-renew:role.self-service-flow-test",
#   "modified": "2026-10-23T00:33:12.487Z"
# }
```

This confirms the role exists with self-service disabled: omitted `selfServe` defaults to `false`. There are no current or pending members, because `roleMembers` is absent even with `pending=true`. That query parameter only includes pending members in the response; it does not enable self-service. `modified` is the role's last-change timestamp in UTC. This is the starting state for the learner's rejection test in Step 3.

## Step 3. Try to join as the learner

Authenticate as `human.idjag-learner` and request its own membership. The role still has self-service disabled, so ZMS should reject the request.

Use the learner's certificate and key here. `add-role-member.sh` authenticates as admin and would not exercise this rejection.

```sh
_self_service_zms_port=$(./tools/port.sh zms) &&
curl -skS --fail-with-body \
  --cert ./keys/idjag-learner.crt \
  --key ./keys/idjag-learner.key \
  -X PUT \
  -H 'Content-Type: application/json' \
  -H 'Athenz-Return-Object: true' \
  -H 'Y-Audit-Ref: self-service learner request' \
  --data '{"memberName":"human.idjag-learner","roleName":"self-service-flow-test"}' \
  "https://localhost:${_self_service_zms_port}/zms/v1/domain/api.test-self-renew/role/self-service-flow-test/member/human.idjag-learner" \
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

This specific 403 is the intended result. A certificate/authentication error does not verify self-service behavior. If the request succeeds here, check the role settings and the learner's existing permissions before continuing.

## Step 4. Enable self-service as admin

Switch to the admin certificate and enable `selfServe` through the role metadata endpoint:

```sh
_self_service_zms_port=$(./tools/port.sh zms) &&
curl -skS --fail-with-body \
  --cert ./athenz_dist/certs/athenz_admin.cert.pem \
  --key ./athenz_dist/keys/athenz_admin.private.pem \
  -X PUT \
  -H 'Content-Type: application/json' \
  -H 'Y-Audit-Ref: enable role self-service' \
  --data '{"selfServe":true}' \
  "https://localhost:${_self_service_zms_port}/zms/v1/domain/api.test-self-renew/role/self-service-flow-test/meta" \
  | jq
```

```sh
# Expected — not captured
# No response body.
```

Read the role back as admin:

```sh
_self_service_zms_port=$(./tools/port.sh zms) &&
curl -skS --fail-with-body \
  --cert ./athenz_dist/certs/athenz_admin.cert.pem \
  --key ./athenz_dist/keys/athenz_admin.private.pem \
  "https://localhost:${_self_service_zms_port}/zms/v1/domain/api.test-self-renew/role/self-service-flow-test" \
  | jq
```

```sh
# Captured from the user's run — Oct 23, 2026
# {
#   "selfServe": true,
#   "name": "api.test-self-renew:role.self-service-flow-test",
#   "modified": "2026-10-23T00:34:37.682Z"
# }
```

Enabling self-service allows membership requests; it does not add the learner.

## Step 5. Request membership as the learner

Repeat the same request from Step 3 with the learner's certificate. `Athenz-Return-Object: true` asks ZMS to return the stored membership object:

```sh
_self_service_zms_port=$(./tools/port.sh zms) &&
curl -skS --fail-with-body \
  --cert ./keys/idjag-learner.crt \
  --key ./keys/idjag-learner.key \
  -X PUT \
  -H 'Content-Type: application/json' \
  -H 'Athenz-Return-Object: true' \
  -H 'Y-Audit-Ref: self-service learner request' \
  --data '{"memberName":"human.idjag-learner","roleName":"self-service-flow-test"}' \
  "https://localhost:${_self_service_zms_port}/zms/v1/domain/api.test-self-renew/role/self-service-flow-test/member/human.idjag-learner" \
  | jq
```

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

The request was accepted and is pending approval: `approved=false` and `pendingState="ADD"`. The captured response also shows `isMember=true`, which the v1.12.48 JDBC store returns for a pending record. It does not mean the membership is approved or active.

As admin, read the role with `pending=true` to include the pending member:

```sh
_self_service_zms_port=$(./tools/port.sh zms) &&
curl -skS --fail-with-body \
  --cert ./athenz_dist/certs/athenz_admin.cert.pem \
  --key ./athenz_dist/keys/athenz_admin.private.pem \
  "https://localhost:${_self_service_zms_port}/zms/v1/domain/api.test-self-renew/role/self-service-flow-test?pending=true" \
  | jq
```

```sh
# Expected — full response not captured
# roleMembers includes human.idjag-learner with:
# active=false, approved=false, pendingState="ADD".
```

As the learner, read the role without `pending=true`. This view should still exclude the pending membership:

```sh
_self_service_zms_port=$(./tools/port.sh zms) &&
curl -skS --fail-with-body \
  --cert ./keys/idjag-learner.crt \
  --key ./keys/idjag-learner.key \
  "https://localhost:${_self_service_zms_port}/zms/v1/domain/api.test-self-renew/role/self-service-flow-test" \
  | jq
```

```sh
# Expected — full response not captured
# roleMembers does not include human.idjag-learner.
```

## Step 6. Try to approve as the learner

Try to approve the pending request as `human.idjag-learner`, using the learner's certificate and key:

```sh
_self_service_zms_port=$(./tools/port.sh zms) &&
curl -skS --fail-with-body \
  --cert ./keys/idjag-learner.crt \
  --key ./keys/idjag-learner.key \
  -X PUT \
  -H 'Content-Type: application/json' \
  -H 'Y-Audit-Ref: learner self-service approval attempt' \
  --data '{"memberName":"human.idjag-learner","roleName":"self-service-flow-test","approved":true,"active":true}' \
  "https://localhost:${_self_service_zms_port}/zms/v1/domain/api.test-self-renew/role/self-service-flow-test/member/human.idjag-learner/decision" \
  | jq
```

```sh
# Expected from v1.12.48 source — not captured
# curl: (22) The requested URL returned error: 403
# {
#   "code": 403,
#   "message": "principal human.idjag-learner is not authorized to approve / reject members"
# }
```

This 403 is expected because the learner has no `update` or `update_members` permission on the role. `selfServe` allows submitting a membership request but does not grant approval permission. The rejected approval attempt leaves the request pending; continue to Step 7 as admin.

## Step 7. Approve as admin and confirm membership

As admin, approve the pending request and activate the membership:

```sh
_self_service_zms_port=$(./tools/port.sh zms) &&
curl -skS --fail-with-body \
  --cert ./athenz_dist/certs/athenz_admin.cert.pem \
  --key ./athenz_dist/keys/athenz_admin.private.pem \
  -X PUT \
  -H 'Content-Type: application/json' \
  -H 'Y-Audit-Ref: approve self-service membership' \
  --data '{"memberName":"human.idjag-learner","roleName":"self-service-flow-test","approved":true,"active":true}' \
  "https://localhost:${_self_service_zms_port}/zms/v1/domain/api.test-self-renew/role/self-service-flow-test/member/human.idjag-learner/decision" \
  | jq
```

```sh
# Expected — not captured
# No response body.
```

As the learner, repeat the normal role GET. It should now include the approved member:

```sh
_self_service_zms_port=$(./tools/port.sh zms) &&
curl -skS --fail-with-body \
  --cert ./keys/idjag-learner.crt \
  --key ./keys/idjag-learner.key \
  "https://localhost:${_self_service_zms_port}/zms/v1/domain/api.test-self-renew/role/self-service-flow-test" \
  | jq
```

```sh
# Expected — full response not captured
# roleMembers includes human.idjag-learner with approved=true.
# active is true or omitted (the default is true).
# The member no longer has pendingState="ADD".
```

The expected progression is rejection → pending request → approved, active membership. Access to protected resources still depends on policies referencing this role.

## Clean-up 8. Delete the test role

After completing Step 7, delete the test role and its membership so the same role name can be reused on the next run:

```sh
./tools/athenz/delete-role.sh \
  api.test-self-renew \
  self-service-flow-test
```

```sh
# Expected cleanup log — not captured
#   ·  Deleting role api.test-self-renew:role.self-service-flow-test...
#   ✔  Role deleted or already absent: api.test-self-renew:role.self-service-flow-test
```

# Reference

- [Athenz v1.12.48 role settings and membership fields](https://github.com/AthenZ/athenz/blob/v1.12.48/core/zms/src/main/rdl/Role.tdl)
- [Role, membership, metadata, and approval APIs](https://github.com/AthenZ/athenz/blob/v1.12.48/core/zms/src/main/rdl/Role.rdli)
- [Membership authorization and self-service pending state](https://github.com/AthenZ/athenz/blob/v1.12.48/servers/zms/src/main/java/com/yahoo/athenz/zms/ZMSImpl.java#L11276-L11314)
- [Membership approval authorization](https://github.com/AthenZ/athenz/blob/v1.12.48/servers/zms/src/main/java/com/yahoo/athenz/zms/ZMSImpl.java#L11076-L11124)
- [Pending membership storage and returned object](https://github.com/AthenZ/athenz/blob/v1.12.48/servers/zms/src/main/java/com/yahoo/athenz/zms/DBService.java#L2174-L2245)
- [JDBC membership lookup, including pending records](https://github.com/AthenZ/athenz/blob/v1.12.48/libs/java/server_common/src/main/java/com/yahoo/athenz/common/server/store/impl/JDBCConnection.java#L2670-L2744)
