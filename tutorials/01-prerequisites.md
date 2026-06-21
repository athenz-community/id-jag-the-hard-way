|       Previous       |      Current      |                      Next                      |
|:--------------------:|:-----------------:|:----------------------------------------------:|
| [Home](../README.md) | **Prerequisites** | [Working Directory](./02-working-directory.md) |

# Prerequisites

Before starting, make sure you have the following installed on your machine.

<!-- TOC depthFrom:2 depthTo:2 -->

- [Install Docker](#install-docker)
- [Reminder](#reminder)

<!-- /TOC -->

## Install Docker

All components in this tutorial run inside Kubernetes, which itself runs inside Docker. Docker is the only hard prerequisite.

> [!NOTE]
> Official install guide: https://docs.docker.com/get-started/get-docker/

Verify Docker is running:

```sh
docker version
```

## Reminder

The results of this tutorial should not be considered production-ready. The goal is to learn the architecture, not to ship a hardened production platform.

Next: [Working Directory](./02-working-directory.md)
