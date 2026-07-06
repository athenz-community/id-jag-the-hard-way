# Goal

The goal is to summarize errors by type when fetching an Athenz user certificate through the Keycloak IdP user-certificate flow:

<!-- TOC depthFrom:2 depthTo:3 -->

- [Error: IdP token endpoint must be an https url](#error-idp-token-endpoint-must-be-an-https-url)

<!-- /TOC -->

## Error: IdP token endpoint must be an https url

ZTS rejects the user-certificate provider when the configured IdP token endpoint is not HTTPS:

```text
IdP token endpoint must be an https url
```

```sh
kubectl logs -n athenz -l athenz=zts-server | grep 'IdP token endpoint must be an https url'
```

This means `athenz.zts.user_cert.idp_token_endpoint` is still configured with `http://...`; it must use `https://...`.
