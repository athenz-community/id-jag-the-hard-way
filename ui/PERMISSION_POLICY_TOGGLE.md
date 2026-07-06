# Why the Permission UI Changes Policies, Not Role Members

The permission diagram UI toggles Athenz policy rules instead of removing principals from roles.

This is intentional for the demo.

## Access Tokens Keep Their Granted Roles

When a user or AI-facing component fetches an Athenz Access Token, Athenz evaluates role membership at token issuance time. If the principal is allowed to assume a role, the issued token carries that granted scope until the token expires.

Removing a principal from a role does not immediately invalidate Access Tokens that were already issued. As long as the holder still has a valid token, the old granted scope can continue to be presented.

```text
remove role member
-> blocks future token issuance
-> does not revoke already-issued Access Tokens
```

## Policy Changes Are Faster To Observe

For this UI, a click on the permission diagram should have a visible effect quickly. Changing the policy rule is the fastest way to show that the authorization boundary moved.

For example, when direct `get:docs` access is revoked, the UI removes this policy assertion:

```text
ALLOW get api:role.docs-getter api:docs
```

When AI-agent exchange access is revoked, the UI removes the relevant `zts.jag_exchange` policy, such as:

```text
ALLOW zts.jag_exchange api:role.jag-exchanging-ai-agents api:role.docs-getter
```

The role can still exist, and members can still be assigned to it. What changed is whether that role is currently allowed to perform the action on the target resource.

## Why This Matters For The Diagram

The UI is trying to visualize the active authorization path:

```text
human.idjag-learner -> AI -> MCP -> API resource
```

If the UI removed role members, existing Access Tokens could make the diagram misleading: the diagram would say permission is gone, but a previously issued token might still work until expiration.

By toggling policy rules instead, the UI focuses on the active authorization boundary:

```text
policy allows action -> flow is green
policy denies action -> flow is red
```

That makes the demo easier to understand. Policy changes show the control plane moving immediately, while role membership remains a slower input into future token issuance.

## Production Note

This is not a full token revocation system. A production system still needs a complete strategy for token lifetime, revocation, policy propagation, audit, and reauthorization.

For this UI, modifying policy is the clearest and fastest way to show permission changes without waiting for existing Access Tokens to expire.
