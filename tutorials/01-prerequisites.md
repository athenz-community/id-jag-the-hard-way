|       Previous       |      Current      |                      Next                      |
|:--------------------:|:-----------------:|:----------------------------------------------:|
| [Home](../README.md) | **Prerequisites** | [Working Directory](./02-working-directory.md) |

# Prerequisites

In this tutorial, we will review the machine requirements for this tutorial with the following steps:

<!-- TOC depthFrom:2 depthTo:2 -->

- [Review Virtual or Physical Machines](#review-virtual-or-physical-machines)
- [Install Packages](#install-packages)
- [Review Port Usage](#review-port-usage)
- [Reminder](#reminder)

<!-- /TOC -->

## Review Virtual or Physical Machines

This tutorial has been tested and confirmed to work seamlessly on the specifications below. While we expect it to run smoothly on lower-spec machines, those configurations haven't been officially verified. If you successfully run this tutorial on lower specifications, please open an Issue with your setup, and we will update this document!

|      OS       |          CPU          | Memory |    LLM     |      Status      |
|:-------------:|:---------------------:|:------:|:----------:|:----------------:|
|  Tahoe 26.2   |        M3 Pro         |  36GB  | gemma4:e4b | Verified Working |
| Ubuntu 24 LTS | Intel Core i7-11700KF |  32GB  | gemma4:e4b | Verified Working |

## Install Packages

> [!NOTE]
> Homebrew: https://brew.sh/

Install Homebrew:

```sh
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

Then install the following package:

```sh
brew install jq pyenv gh
```

## Review Port Usage

If you are interested in knowing what kind of ports used by default for this tutorial, you may expand the following.

<details>
  <summary>Click to expand</summary>
  <br>

  AI Client Agent:

  - `3100`: Open WebUI Port with Keycloak
  - `3101`: OpenAI Athenz Client Gateway
  - `3200`: Open WebUI Port without Keycloak
  - `11434`: Ollama

  IdP:

  - `9090`: Keycloak Server

  Authorization Server (Athenz):

  - `3000`: Athenz UI
  - `4443`: Athenz ZMS
  - `8443`: Athenz ZTS

  Resource Server (API Server):

  - `8102`: Athenz Authorization Proxy for API MCP Server (🟡 TODO: Will be removed, replaced by `24443`)
  - `14443`: API Server
  - `24443`: MCP Server
</details>

## Reminder

The results of this tutorial should not be considered production ready. The goal is to learn the architecture, not to ship a hardened production platform

Next: [Working Directory](./02-working-directory.md)
