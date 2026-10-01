| 前へ | 現在 | 次へ |
|:---:|:---:|:---:|
| [はじめに](./00-README.md) | **作業ディレクトリ** | [事前準備](./02-prerequisites.md) |

<a id="working-directory"></a>

# 作業ディレクトリ

チュートリアルで使う作業ディレクトリを準備します。以降のコマンドはこのディレクトリで実行します。

<!-- TOC depthFrom:2 depthTo:2 -->

- [リポジトリを複製する](#clone-the-repository)
- [作業ディレクトリに移動する](#enter-the-working-directory)
- [リポジトリのルートでコマンドを実行する](#run-commands-from-the-repository-root)

<!-- /TOC -->

<a id="create-directory"></a>

<a id="clone-the-repository"></a>

## リポジトリを複製する

次のいずれかの方法で、プロジェクトを `~/id_jag_the_hard_way_workspace` に複製します：

GitHub CLI の `gh` を使う場合：

```sh
gh repo fork mlajkim/id-jag-the-hard-way --clone -- --destination ~/id_jag_the_hard_way_workspace
```

Git で SSH を使う場合：

```sh
git clone git@github.com:mlajkim/id-jag-the-hard-way.git ~/id_jag_the_hard_way_workspace
```

Git で HTTPS を使う場合：

```sh
git clone https://github.com/mlajkim/id-jag-the-hard-way.git ~/id_jag_the_hard_way_workspace
```

<a id="change-directory"></a>

<a id="enter-the-working-directory"></a>

## 作業ディレクトリに移動する

```sh
cd ~/id_jag_the_hard_way_workspace
```

Git サブモジュールを取得します：

```sh
git submodule update --init --recursive
```

<a id="stay-on-the-directory-id_jag_the_hard_way_workspace"></a>

<a id="run-commands-from-the-repository-root"></a>

## リポジトリのルートでコマンドを実行する

チュートリアルのコマンドはリポジトリのルートで実行します。別のターミナルを開いたときも同じディレクトリに移動してください。複製先の名前や場所は変更できますが、コマンド中の相対パスはリポジトリのルートを基準にしています。

リポジトリとサブモジュールの準備ができました。次の章では、チュートリアルに必要なツールを確認します。

次へ：[事前準備](./02-prerequisites.md)
