| 이전 | 현재 | 다음 |
|:---:|:---:|:---:|
| [Kubernetes 클러스터](./03-kubernetes-cluster.md) | **리소스 서버 (Resource Server)** | [인가 서버 (Authorization Server)](./05-authorization-server.md) |

<a id="resource-server"></a>

# 리소스 서버 (Resource Server)

간단한 문서 API를 배포하고 액세스 토큰 (Access Token) 없이 문서를 조회합니다. 이후 토큰 검증을 켜고 같은 요청이 거부되는지 확인합니다.

<!-- TOC depthFrom:2 depthTo:2 -->

- [API 네임스페이스 생성](#create-the-api-namespace)
- [API 서버 배포](#deploy-the-api-server)
- [API 서버에 요청 보내기](#send-a-request-to-the-api-server)
- [동작 확인](#understand-the-result)
- [API의 동작 방식](#learn-about-the-api)
- [액세스 토큰 검증 활성화](#enable-access-token-enforcement)
- [다음 단계](#next-steps)

<!-- /TOC -->

<a id="create-a-namespace-api-in-kubernetes"></a>

<a id="create-the-api-namespace"></a>

## API 네임스페이스 생성

```sh
kubectl create ns api
```

```sh
# namespace/api created
```

<a id="deploy-a-simple-api-server-to-the-kubernetes"></a>

<a id="deploy-the-api-server"></a>

## API 서버 배포

```sh
kubectl create deploy api-server -n api \
  --image=ghcr.io/mlajkim/idthw-demo-api:latest
```


Kubernetes Service를 통해 Deployment에 접근할 수 있도록 설정합니다:

```sh
kubectl expose deploy api-server -n api --port 8080 --name api-server
```

```sh
# service/api-server exposed
```

<a id="send-a-request-to-the-api-server"></a>

## API 서버에 요청 보내기

배포가 준비될 때까지 기다립니다:

```sh
kubectl rollout status deploy/api-server -n api
```

```sh
# deployment "api-server" successfully rolled out
```

액세스 토큰 없이 문서를 요청합니다:

```sh
kubectl exec deploy/api-server -n api \
  -- node -e 'fetch("http://localhost:8080/api/docs").then(async r => console.log(await r.text()))' | jq
```

```sh
# {
#   "docs": [
#     { "id": 1, "name": "first default doc", "content": "hello world" },
#     { "id": 2, "name": "second default doc", "content": "how are you?" }
#   ]
# }
```

<a id="learn-whats-happened"></a>

<a id="understand-the-result"></a>

## 동작 확인

아직 액세스 토큰 검증이 꺼져 있으므로 API는 `200 OK`와 문서 목록을 반환합니다:

![토큰 검증이 꺼진 API에 사용자가 문서를 요청하는 흐름](../assets/core_04_open_api.svg)

<a id="learn-about-the-api"></a>

## API의 동작 방식

이 API 서버는 학습을 위해 단순하게 구성되어 있습니다.

데이터베이스 대신 메모리에 문서를 저장합니다. API 서버를 다시 시작하면 저장된 데이터가 기본 예제 문서로 초기화됩니다.

쉽게 실행하고 초기화할 수 있으므로, 인가 설정에 따라 API의 동작이 어떻게 달라지는지 확인하기에 적합합니다.

<a id="verify-access-token-enforcement"></a>
<a id="access-token-mode"></a>

<a id="enable-access-token-enforcement"></a>

## 액세스 토큰 검증 활성화

`ACCESS_TOKEN_ENABLED=true`로 설정해 유효한 Athenz 액세스 토큰과 각 문서 작업에 필요한 스코프를 요구하도록 합니다:

```sh
kubectl set env deploy/api-server -n api ACCESS_TOKEN_ENABLED=true
kubectl rollout status deploy/api-server -n api
```

토큰 없이 같은 요청을 다시 보냅니다:

```sh
kubectl exec deploy/api-server -n api \
  -- node -e 'fetch("http://localhost:8080/api/docs").then(async r => console.log(await r.text()))' | jq
```

```sh
# {
#   "error": "missing_access_token",
#   "message": "Pass an Athenz access token as Authorization: Bearer <token>."
# }
```

이제 API는 `401 Unauthorized`를 반환합니다. 토큰 검증을 켰지만 요청에 액세스 토큰이 없기 때문에 발생하는 의도된 실패입니다.

![액세스 토큰이 없는 문서 요청을 거부하는 API](../assets/core_04_api_rejected.svg)

토큰 검증은 켜 둔 상태로 진행합니다.

<a id="learn-whats-next"></a>

<a id="next-steps"></a>

## 다음 단계

이제 API에 접근하려면 액세스 토큰이 필요합니다. 다음 장에서는 인가 서버 (Authorization Server)로 Athenz를 배포합니다.

다음: [인가 서버 (Authorization Server)](./05-authorization-server.md)
