|               Previous               |        Current        |                        Next                        |
|:------------------------------------:|:---------------------:|:--------------------------------------------------:|
| [Prerequisites](01-prerequisites.md) | **Working Directory** | [Kubernetes Cluster](./02.2-kubernetes-cluster.md) |

# Working Directory

In this tutorial, we will set up a working directory for the tutorial with the following steps:

<!-- TOC depthFrom:2 depthTo:2 -->

- [Create directory](#create-directory)
- [Change directory](#change-directory)
- [Stay on the directory `~/id_jag_the_hard_way_workspace`](#stay-on-the-directory-id_jag_the_hard_way_workspace)

<!-- /TOC -->

## Create directory

We will create a directory `~/id_jag_the_hard_way_workspace` by cloning the project:

If you are using `gh` for GitHub:

```sh
gh repo fork mlajkim/id-jag-the-hard-way --clone -- --destination ~/id_jag_the_hard_way_workspace
```

If you are using SSH for git:

```sh
git clone git@github.com:mlajkim/id-jag-the-hard-way.git ~/id_jag_the_hard_way_workspace
```

If you are using HTTPS for git:

```sh
git clone https://github.com/mlajkim/id-jag-the-hard-way.git ~/id_jag_the_hard_way_workspace
```

## Change directory

```sh
cd ~/id_jag_the_hard_way_workspace
```

Sync submodule codes:

```sh
git submodule update --init --recursive
```

## Stay on the directory `~/id_jag_the_hard_way_workspace`

Every script used in this tutorial will assume that it is being run from the `id_jag_the_hard_way_workspace` directory. If you need to run any script, you will need to change into this directory first. The name & directory can be customized to your needs, as long as you come back to this directory to run any scripts referenced by any tutorial.

Next: [Kubernetes Cluster](./02.2-kubernetes-cluster.md)
