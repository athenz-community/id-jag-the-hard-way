# Goal

The goal of this document is to verify that Athenz ZMS rejects role and group self-renew settings without a positive renewal duration and accepts valid settings, with the following steps:

<!-- TOC depthFrom:2 depthTo:2 -->

- [Step 1. Reject a role with no self-renew duration](#step-1-reject-a-role-with-no-self-renew-duration)
- [Step 2. Accept a role with a positive self-renew duration](#step-2-accept-a-role-with-a-positive-self-renew-duration)
- [Step 3. Reject a group with a zero self-renew duration](#step-3-reject-a-group-with-a-zero-self-renew-duration)
- [Step 4. Accept a group with a positive self-renew duration](#step-4-accept-a-group-with-a-positive-self-renew-duration)
- [Clean-up 5. Remove the temporary role and group](#clean-up-5-remove-the-temporary-role-and-group)

<!-- /TOC -->

<details>
<summary>Last human verified on Aug 14, 2026 — ✅ Success</summary>

| # | Date         | Confirmed Working                                                                                     |
|---|--------------|-------------------------------------------------------------------------------------------------------|
| 1 | Aug 14, 2026 | ✅ Human verified — invalid self-renew settings were rejected and valid role/group settings succeeded |

</details>

# Prerequisites

This tutorial requires the following to be completed:

1. Complete the main [ID-JAG The Hard Way tutorial](../../../tutorials/16-id-jag.md), including the final ID-JAG step.
1. Keep `./tools/keep-k8s-port-forward.sh` running in another terminal.

# Steps

Here is the procedure to get to the goals.

## Step 1. Reject a role with no self-renew duration

`selfRenew` allows an existing role member to extend their membership. `selfRenewMins` specifies the number of minutes by which the membership can be renewed. Enabling the feature without a positive duration would create an unusable configuration.

Try to create a temporary role with `selfRenew` enabled but no `selfRenewMins` value:

```sh
./tools/athenz/create-role.sh \
  api \
  self-renew-validation-test \
  --self-renew
```

```sh
#   ·  Creating Role: api:role.self-renew-validation-test...
#   ✘  ZMS error response:
# {"code":400,"message":"Role cannot enable self-renew without a positive selfRenewMins value"}

# ✘ Failed to create role api:role.self-renew-validation-test
```

The error code confirms that ZMS rejects the inconsistent role before storing it.

## Step 2. Accept a role with a positive self-renew duration

Repeat the request with a positive `selfRenewMins` value:

```sh
./tools/athenz/create-role.sh \
  api \
  self-renew-validation-test \
  --self-renew \
  --self-renew-mins 10
```

```sh
#   ·  Creating Role: api:role.self-renew-validation-test...
#   ✔  Role created: api:role.self-renew-validation-test
```

Read the role back from ZMS:

```sh
curl -skS \
  --cert ./athenz_dist/certs/athenz_admin.cert.pem \
  --key ./athenz_dist/keys/athenz_admin.private.pem \
  "https://localhost:$(./tools/port.sh zms)/zms/v1/domain/api/role/self-renew-validation-test" \
  | jq
```

```sh
# {
#   "selfRenew": true,
#   "selfRenewMins": 10,
#   "name": "api:role.self-renew-validation-test",
#   "modified": "2026-08-13T23:07:44.467Z"
# }
```

The success result and stored values confirm that ZMS accepts a positive renewal duration.

## Step 3. Reject a group with a zero self-renew duration

The same rule applies to groups. Use `0` to verify that a present but non-positive duration is also rejected:

```sh
./tools/athenz/create-group.sh \
  api \
  self-renew-validation-test \
  --self-renew \
  --self-renew-mins 0
```

```sh
#   ·  Creating Group: api:group.self-renew-validation-test...
#   ✘  ZMS error response:
# {"code":400,"message":"Group cannot enable self-renew without a positive selfRenewMins value"}
#   ✘  Failed to create group api:group.self-renew-validation-test
```

The `400` response confirms that setting the duration to zero cannot bypass the validation.

## Step 4. Accept a group with a positive self-renew duration

Repeat the group request with a positive duration:

```sh
./tools/athenz/create-group.sh \
  api \
  self-renew-validation-test \
  --self-renew \
  --self-renew-mins 10
```

```sh
#   ·  Creating Group: api:group.self-renew-validation-test...
#   ✔  Group created: api:group.self-renew-validation-test
```

Read the group back from ZMS:

```sh
curl -skS \
  --cert ./athenz_dist/certs/athenz_admin.cert.pem \
  --key ./athenz_dist/keys/athenz_admin.private.pem \
  "https://localhost:$(./tools/port.sh zms)/zms/v1/domain/api/group/self-renew-validation-test" \
  | jq
```

```sh
# {
#   "name": "api:group.self-renew-validation-test",
#   "selfRenew": true,
#   "selfRenewMins": 10
# }
```

Together, the rejection and acceptance results verify that the validation applies consistently to both roles and groups.

## Clean-up 5. Remove the temporary role and group

Delete the two valid objects created by this test:

```sh
./tools/athenz/delete-role.sh \
  api \
  self-renew-validation-test

./tools/athenz/delete-group.sh \
  api \
  self-renew-validation-test
```

```sh
#   ·  Deleting role api:role.self-renew-validation-test...
#   ✔  Role deleted or already absent: api:role.self-renew-validation-test
#   ·  Deleting group api:group.self-renew-validation-test...
#   ✔  Group deleted or already absent: api:group.self-renew-validation-test
```

# Reference

- May 24, 2026 — [Athenz PR #3371 — add validation for selfRenew in ZMS](https://github.com/AthenZ/athenz/pull/3371)
