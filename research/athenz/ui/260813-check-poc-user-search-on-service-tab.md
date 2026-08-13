# Goal

The goal of this document is to verify that the Athenz UI loads Point of Contact and Security Point of Contact user search results when a domain is opened directly on the Services tab, with the following steps:

<!-- TOC depthFrom:2 depthTo:2 -->

- [Step 1. Confirm that the Athenz UI user list is empty](#step-1-confirm-that-the-athenz-ui-user-list-is-empty)
- [Step 2. Add the Athenz admin and ID-JAG learner user data](#step-2-add-the-athenz-admin-and-id-jag-learner-user-data)
- [Step 3. Apply the user data to the UI and test again](#step-3-apply-the-user-data-to-the-ui-and-test-again)
- [Step 4. Open the Services tab and test both contact searches](#step-4-open-the-services-tab-and-test-both-contact-searches)

<!-- /TOC -->

<details>
<summary>Last human verified on Aug 13, 2026 — ✅ Success</summary>

| # | Date         | Confirmed Working                                                      |
|---|--------------|------------------------------------------------------------------------|
| 1 | Aug 13, 2026 | ✅ Human verified — registered user appeared in the Services-tab search |

</details>

# Prerequisites

This tutorial requires the following to be completed:

1. Complete the main [ID-JAG The Hard Way tutorial](../../../tutorials/16-id-jag.md), including the final ID-JAG step.

# Steps

Here is the procedure to get to the goals.

## Step 1. Confirm that the Athenz UI user list is empty

Check the user list returned to the browser client:

```sh
curl -sS \
  "http://localhost:$(./tools/port.sh athenz-ui)/api/v1/all-users" \
  | jq
```

```sh
# {
#   "users": []
# }
```

The empty array explains why entering `user.idjag-learner` previously showed only the text that was typed. The UI had no registered user data to return.

## Step 2. Add the Athenz admin and ID-JAG learner user data

The Point of Contact dialogs do not discover users from Keycloak, user certificates, or ZMS. They use the Athenz UI's own user directory.

Create a temporary ConfigMap containing `athenz_admin` and `idjag-learner` as enabled human users. The small preload invokes the UI's existing `readUsersFileFromDisk()` function; it does not modify `athenz_dist/`:

```sh
kubectl -n athenz create configmap athenz-ui-test-users \
  --from-literal=users_data.json='[{"is_human":1,"login":"athenz_admin","gecos":"Athenz Admin","enabled_status":1},{"is_human":1,"login":"idjag-learner","gecos":"ID-JAG Learner","enabled_status":1}]' \
  --from-literal=load-users.js='const userService = require("/home/athenz/src/server/services/userService"); userService.readUsersFileFromDisk("users_data.json");'
```

```sh
# configmap/athenz-ui-test-users created
```

The UI converts these directory entries into the searchable results `Athenz Admin [user.athenz_admin]` and `ID-JAG Learner [user.idjag-learner]`.

## Step 3. Apply the user data to the UI and test again

Patch only the running Athenz UI Deployment to mount and load the temporary user data:

```sh
kubectl -n athenz patch deployment athenz-ui \
  --type strategic \
  --patch '{
    "spec": {
      "template": {
        "spec": {
          "volumes": [
            {
              "name": "athenz-ui-test-users",
              "configMap": {"name": "athenz-ui-test-users"}
            }
          ],
          "containers": [
            {
              "name": "athenz-ui",
              "env": [
                {
                  "name": "NODE_OPTIONS",
                  "value": "--require=/home/athenz/load-users.js"
                }
              ],
              "volumeMounts": [
                {
                  "name": "athenz-ui-test-users",
                  "mountPath": "/home/athenz/.users_data.json",
                  "subPath": "users_data.json",
                  "readOnly": true
                },
                {
                  "name": "athenz-ui-test-users",
                  "mountPath": "/home/athenz/load-users.js",
                  "subPath": "load-users.js",
                  "readOnly": true
                }
              ]
            }
          ]
        }
      }
    }
  }'

kubectl -n athenz rollout status deployment/athenz-ui
```

```sh
# deployment.apps/athenz-ui patched
# deployment "athenz-ui" successfully rolled out
```

Run the same request from Step 1 again:

```sh
curl -sS \
  "http://localhost:$(./tools/port.sh athenz-ui)/api/v1/all-users" \
  | jq
```

```sh
# {
#   "users": [
#     {
#       "login": "athenz_admin",
#       "name": "Athenz Admin"
#     },
#     {
#       "login": "idjag-learner",
#       "name": "ID-JAG Learner"
#     }
#   ]
# }
```

This response confirms that the UI now has real user data for the POC searches.

## Step 4. Open the Services tab and test both contact searches

Open the `api` domain directly on the Services tab. Do not visit the Roles or Groups tab first because those tabs could load the client-side user list and hide the original problem:

```sh
./tools/open.sh \
  "http://localhost:$(./tools/port.sh athenz-ui)/domain/api/service"
```

```sh
#   ✔  Opened: http://localhost:3000/domain/api/service
```

At the top of the Services page, test **POINT OF CONTACT**:

![Open Point of Contact from the api Services tab](api-service-tab-point-of-contact-link.png)

1. Click the value above **POINT OF CONTACT**. The value may be **add** when no contact is configured.
1. Enter `user.idjag-learner`.
1. Confirm that the dropdown shows `ID-JAG Learner [user.idjag-learner]`.

![Registered ID-JAG learner returned by the Point of Contact search](poc-search-registered-idjag-learner-result.png)

The display name and `[user.idjag-learner]` principal confirm that this is the registered directory result rather than an echoed fallback value.

The same applies for **SECURITY POINT OF CONTACT**.

# Reference

The related UI changes were introduced in this order:

- Aug 22, 2023 — [Athenz PR #2272 — ability to add members by searching for their names](https://github.com/AthenZ/athenz/pull/2272) introduced the `Display Name [user.principal]` search-result format.
- Feb 24, 2024 — [Athenz PR #2521 — support domain (security) point of contact fields](https://github.com/AthenZ/athenz/pull/2521) reused that user search for Point of Contact and Security Point of Contact.
- Oct 28, 2024 — [Athenz PR #2774 — improve UX of dropdown inputs](https://github.com/AthenZ/athenz/pull/2774) improved dropdown selection and validation behavior.
- May 22, 2026 — [Athenz PR #3370 — fix POC and security POC not loading on non role/group domain tabs](https://github.com/AthenZ/athenz/pull/3370) made the shared user list load when a domain is opened directly on tabs such as Services.
