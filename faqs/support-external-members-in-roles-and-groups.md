# Goal

The goal of this tutorial is to test Athenz external members in roles and groups with an email-address member name, using `email` as the external member namespace and the local ZMS deployment from this repo.

<!-- TOC depthFrom:2 depthTo:3 -->

- [Step 1. Configure ZMS Email Validation](#step-1-configure-zms-email-validation)
- [Step 2. Register the External Member Validator on the Domain](#step-2-register-the-external-member-validator-on-the-domain)
- [Step 3. Restart ZMS](#step-3-restart-zms)
- [Step 4. Add an Email External Member to a Role](#step-4-add-an-email-external-member-to-a-role)
- [Step 5. Add an Email External Member to a Group](#step-5-add-an-email-external-member-to-a-group)
- [Step 6. Verify Group-Expanded Role Lookup](#step-6-verify-group-expanded-role-lookup)
- [Step 7. Verify a Rejected Email Member](#step-7-verify-a-rejected-email-member)

<!-- /TOC -->

> [!NOTE]
> This tutorial uses the same email as the local Keycloak user, `idjag-learner@athenz.io`, but the built-in email validator does not call Keycloak. It validates the external member string stored in Athenz. That makes it a good first test before wiring a custom validator to a real IdP lookup.

# Prerequisites

- Complete the main tutorial through [ID-JAG](../tutorials/16-id-jag.md).
- Have the local ZMS port-forward running through the normal tutorial setup.
- Use Athenz `v1.12.38` or later. `v1.12.37` introduced the feature, but `v1.12.38` fixed important external-member validation behavior. This tutorial was checked against the upstream `v1.12.43` tag.

# Background

External members use this member-name shape:

```text
<external-domain>:ext.<external-member-name>
```

For this tutorial:

```text
email:ext.idjag-learner@athenz.io
```

The part before `:ext.` is the external member domain. ZMS looks up the external member validator from that domain's `externalMemberValidator` metadata. The part after `:ext.` is passed to the validator. In this example, the built-in email validator receives only:

```text
idjag-learner@athenz.io
```

# Steps

## Step 1. Configure ZMS Email Validation

Athenz includes a sample validator class for email-address external members:

```text
com.yahoo.athenz.auth.impl.ExternalEmailMemberValidator
```

By default, it accepts any syntactically valid email address. For a more useful local test, configure it to accept only the tutorial email domain, `athenz.io`.

Edit the ZMS ConfigMap:

```sh
kubectl edit configmap athenz-zms-conf -n athenz
```

Inside `vim`:

1. Type `/zms.prop` and press **Enter** to jump to the properties section.
2. Press `o` to open a new line below in Insert mode.
3. Paste the following properties:

```properties
    athenz.external_member.valid_email_domains=athenz.io
    athenz.zms.external_member_validator_frequency_minutes=1
```

*The four spaces above are **intended**.*

4. Press `Esc`.
5. Enter `:wq` and press **Enter**.

```sh
# configmap/athenz-zms-conf edited
```

The first property restricts accepted email addresses to `@athenz.io`. If you remove it, the validator accepts any syntactically valid email address. The second property makes ZMS refresh domain-to-validator mappings every minute, which is convenient while testing.

## Step 2. Register the External Member Validator on the Domain

Use the existing `api` domain as the protected resource domain, and create `email` as the external member namespace.

Create the `email` top-level domain if it does not already exist:

```sh
./tools/athenz/create-tld.sh "email"
```

```sh
  # ·  Creating TLD: email...
  # ✔  TLD created: email
```

Now register the email validator on `email`:

```sh
./tools/athenz/set-domain-external-member-validator.sh \
  "email" \
  "com.yahoo.athenz.auth.impl.ExternalEmailMemberValidator"
```

```sh
#   Setting external member validator for domain email...
#   External member validator set for email: com.yahoo.athenz.auth.impl.ExternalEmailMemberValidator
```

The external member below starts with `email:ext.`, so the validator must be configured on the `email` domain:

```sh
_external_member="email:ext.idjag-learner@athenz.io"
```

If you later use a different external namespace, such as `partner:ext.alice@example.com`, configure `externalMemberValidator` on the `partner` domain instead.

## Step 3. Restart ZMS

Restart ZMS so it picks up the ConfigMap property and reloads the domain validator mapping immediately.

```sh
kubectl -n athenz rollout restart deployment/athenz-zms-server
kubectl -n athenz rollout status deployment/athenz-zms-server
```

```sh
# deployment.apps/athenz-zms-server restarted
# Waiting for deployment "athenz-zms-server" rollout to finish: 0 out of 1 new replicas have been updated...
# Waiting for deployment "athenz-zms-server" rollout to finish: 0 of 1 updated replicas are available...
# deployment "athenz-zms-server" successfully rolled out
```

## Step 4. Add an Email External Member to a Role

Add the email external member directly to the existing `api:role.docs-getter` role:

```sh
_external_member="email:ext.idjag-learner@athenz.io"

./tools/athenz/add-role-member.sh \
  "api" \
  "docs-getter" \
  "${_external_member}"
```

```sh
#   Adding Member email:ext.idjag-learner@athenz.io to Role: api:role.docs-getter...
#   email:ext.idjag-learner@athenz.io  ->  api:role.docs-getter
```

Verify that the principal-role lookup accepts the external member name:

```sh
_external_member="email:ext.idjag-learner@athenz.io"

./tools/athenz/show-principal-roles.sh \
  "${_external_member}" \
  "api" \
  false
```

Expected output includes `api:role.docs-getter`:

```json
{
  "memberName": "email:ext.idjag-learner@athenz.io",
  "memberRoles": [
    {
      "roleName": "api:role.docs-getter"
    }
  ]
}
```

## Step 5. Add an Email External Member to a Group

Create a group for external email members:

```sh
./tools/athenz/create-group.sh \
  "api" \
  "external-partners"
```

```sh
#   Creating Group: api:group.external-partners...
#   Group created: api:group.external-partners
```

Add the same external member to that group:

```sh
_external_member="email:ext.idjag-learner@athenz.io"

./tools/athenz/add-group-member.sh \
  "api" \
  "external-partners" \
  "${_external_member}"
```

```sh
#   Adding Member email:ext.idjag-learner@athenz.io to Group: api:group.external-partners...
#   email:ext.idjag-learner@athenz.io  ->  api:group.external-partners
```

Verify that the principal-group lookup accepts the external member name:

```sh
_external_member="email:ext.idjag-learner@athenz.io"

./tools/athenz/show-principal-groups.sh \
  "${_external_member}" \
  "api"
```

Expected output includes `api:group.external-partners`:

```json
{
  "memberName": "email:ext.idjag-learner@athenz.io",
  "memberGroups": [
    {
      "groupName": "api:group.external-partners"
    }
  ]
}
```

## Step 6. Verify Group-Expanded Role Lookup

Create a role that will be granted through the group:

```sh
./tools/athenz/create-role.sh \
  "api" \
  "external-group-docs-getter"
```

```sh
#   Creating Role: api:role.external-group-docs-getter...
#   Role created: api:role.external-group-docs-getter
```

Add the group as a role member:

```sh
./tools/athenz/add-role-member.sh \
  "api" \
  "external-group-docs-getter" \
  "api:group.external-partners"
```

```sh
#   Adding Member api:group.external-partners to Role: api:role.external-group-docs-getter...
#   api:group.external-partners  ->  api:role.external-group-docs-getter
```

Now query the external email member's roles with `expand=true`:

```sh
./tools/athenz/show-principal-roles.sh \
  "${_external_member}" \
  "api" \
  true
```

Expected output includes the direct role and the group-expanded role:

```json
{
  "memberName": "email:ext.idjag-learner@athenz.io",
  "memberRoles": [
    {
      "roleName": "api:role.docs-getter"
    },
    {
      "roleName": "api:role.external-group-docs-getter"
    }
  ]
}
```

## Step 7. Verify a Rejected Email Member

Try adding a value that is not an email address:

```sh
./tools/athenz/add-role-member.sh \
  "api" \
  "docs-getter" \
  "email:ext.not-an-email"
```

Expected failure:

```sh
#   ·  Adding Member email:ext.not-an-email to Role: api:role.docs-getter...
#   ✘  ZMS error response:
# {"code":400,"message":"Member not-an-email is not valid according to the external member validator for domain api"}

# ✘ Failed to add email:ext.not-an-email to api:role.docs-getter
```

If you configured `athenz.external_member.valid_email_domains=athenz.io`, this should also fail because the email domain is not allowed:

```sh
./tools/athenz/add-role-member.sh \
  "api" \
  "docs-getter" \
  "email:ext.someone@example.com"
```

```sh
#   ·  Adding Member email:ext.someone@example.com to Role: api:role.docs-getter...
#   ✘  ZMS error response:
# {"code":400,"message":"Member someone@example.com is not valid according to the external member validator for domain api"}

# ✘ Failed to add email:ext.someone@example.com to api:role.docs-getter
```

# Reference

- [Athenz PR 3263](https://github.com/AthenZ/athenz/pull/3263) added external member support for roles and groups, and updated principal lookup inputs to use `PrincipalName`.
- Athenz `v1.12.38` includes follow-up external-member fixes after `v1.12.37`: extracting the external domain prefix before calling the validator, and using the correct domain for the external-member validation check.
- `ExternalEmailMemberValidator` is the built-in sample email validator: `athenz_dist/athenz/libs/java/auth_core/src/main/java/com/yahoo/athenz/auth/impl/ExternalEmailMemberValidator.java`.
- ZMS dispatches external-member validation by splitting on `:ext.`. For `email:ext.idjag-learner@athenz.io`, the validator domain is `email`, and the value passed to the validator is `idjag-learner@athenz.io`.
