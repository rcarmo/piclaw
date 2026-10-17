# PiClaw — セルフホスト型 AI ワークスペース

![PiClaw](docs/icon-256.png)

言語：[English](README.md) · [简体中文](README.zh-CN.md) · **日本語**

PiClaw は [Pi Coding Agent](https://github.com/earendil-works/pi) を基にした、デフォルトではシングルユーザーのセルフホスト型 AI ワークスペースです。同じブラウザーウィンドウでエージェントと作業し、ファイルの編集、コマンドの実行、結果の確認ができます。会話、ファイル、スケジュールタスクは次回のアクセス時にも残ります。モデルへのリクエストは、OpenAI 互換のローカルサーバーを含め、設定したプロバイダーに送信されます。

Web UI は英語、簡体字中国語、日本語に対応し、デスクトップとモバイル向けのレイアウトを備えています。コンテナー、仮想マシン、専用マシンを使い、エージェントがアクセスできるファイルとサービスを制限してください。

![デモアニメーション](docs/demo.gif)

## インストール

| 方法 | 用途 |
|---|---|
| [Docker](#docker-でクイックスタート) | 推奨するデプロイ方法。Bun、PiClaw、コマンドラインツールを同梱 |
| [ポータブル版](docs/getting-started.md#portable-releases) | Docker を使わず Linux、Apple Silicon Mac、実験的な Windows 環境で利用。Bun とランタイムの依存関係を同梱 |
| [Bun でリポジトリからインストール](docs/install-from-repo.md) | インストール済みの Bun を使い、リリースタグを指定する実験的な方法 |
| [ソースビルド](docs/development.md) | 開発とローカルテスト向け |

配布ファイルは [GitHub Releases](https://github.com/rcarmo/piclaw/releases)、コンテナーイメージは [GHCR](https://github.com/rcarmo/piclaw/pkgs/container/piclaw) にあります。同じバージョンを再デプロイできるよう、リリースタグを固定してください。

### Docker でクイックスタート

Docker に加え、モデルプロバイダーの認証情報、または接続可能なローカルモデルサーバーが必要です。プロバイダーは起動後に設定します。

> [!WARNING]
> 新しいインスタンスでは、初期状態で Web ログインが不要です。以下のコマンドはポートを **localhost のみに公開**します。認証の設定中は外部に公開しないでください。保護されていないインスタンスにアクセスできる人は、エージェントのファイルやツールを利用できます。

```bash
mkdir -p ./home ./workspace

docker run -d \
  --init \
  --name piclaw \
  --restart unless-stopped \
  -p 127.0.0.1:8080:8080 \
  -e PICLAW_WEB_PORT=8080 \
  -v "$(pwd)/home:/config" \
  -v "$(pwd)/workspace:/workspace" \
  ghcr.io/rcarmo/piclaw:latest
```

1. Docker ホストで [http://localhost:8080](http://localhost:8080) を開きます。
2. チャットで `/login` を送信し、**モデルプロバイダー**を設定します。ブラウザーへのログインとは別の操作です。PiClaw は Pi のプロバイダー認証情報を再利用するため、Docker コマンドに API キーを含める必要はありません。
3. `/model` でモデルを選択し、「ワークスペースに Markdown のチェックリストを作成し、ファイルを見せて」と依頼してみてください。
4. 他のマシンからのアクセスを許可する前に、[ブラウザー認証](docs/getting-started.md#secure-browser-access)と HTTPS を設定してください。

`./home` と `./workspace` はどちらも永続データを保存します。コンテナーの入れ替え時にも両方を残してください。**リセットやアップグレードのために `workspace/.piclaw/store/messages.db` を削除しないでください。** 詳細は[初回起動の確認、バックアップ、アップグレード](docs/getting-started.md)を参照してください。

## できること

| 作業 | コアに含まれる機能 |
|---|---|
| エージェントと作業 | ストリーミングチャット、モデル選択、実行中の指示変更、追加メッセージのキュー、独立した会話、`/btw` による別の質問 |
| ファイルの操作 | ワークスペースのファイルブラウザー、アップロード、CodeMirror エディター、シェルツール、切り離し可能な xterm.js ターミナル |
| 結果の確認 | CSV/TSV テーブル、PDF、画像、動画、コードのビューアー、VNC リモート画面ペイン |
| 次回も作業を継続 | スケジュールタスク、検索可能なチャット履歴、ファイルベースの [Dream メモリー](docs/dream-memory.md) |
| ワークフローの拡張 | スキル、[MCP サーバー](docs/mcp.md)、ブラウザー自動化、画像処理、Adaptive Cards、対話型の図表や成果物 |

[Web UI ガイド](docs/web-ui.md#chat-and-status-surfaces)と[ツール・スキルのリファレンス](docs/tools-and-skills.md)に操作方法とコマンドを記載しています。ローカルモデルの設定は [llama.cpp](docs/llama-cpp.md) を参照してください。Azure での画像生成には [Azure OpenAI/Foundry の設定](docs/azure/azure-openai-extension.md)が必要です。

[任意のアドオン](https://rcarmo.github.io/piclaw-addons/)で Draw.io、Office 文書の表示とツール、カンバン、別のターミナルレンダラー、Windows デスクトップ自動化、Proxmox、Portainer、Microsoft 365、ペアリングしたインスタンス間のメッセージ送信を利用できます。[設定とアドオン](docs/settings-and-addons.md)から個別にインストールしてください。

## セキュリティと制限

- **デフォルトはシングルユーザーです。** [実験的な家族モード](docs/multi-user/README.md)は、少人数のグループ向けの、互いを信頼するユーザーによるマルチユーザーモードです。昇格済みの `family-shared` デプロイでは、所有者ごとの会話を利用できますが、ワークスペースとプロセスは共有され、ファイルシステムは隔離されません。隔離コンテナーモードは利用できません。[家族モードのユーザーガイド](docs/multi-user/user-guide.md)も参照してください。
- エージェントは、プロセスを実行するユーザーの権限で動作します。ネイティブインストールではそのユーザーのファイルとコマンド、コンテナーではマウントしたファイルと設定上アクセス可能なネットワークを利用できます。専用環境を使い、共有するつもりのファイルだけをマウントしてください。
- ブラウザー認証は認証アプリのコード（TOTP）とパスキーに対応しています。バックエンドは非公開にし、リモートアクセスには HTTPS を使い、設定した[リバースプロキシ](docs/reverse-proxy.md)からの転送ヘッダーのみを信頼してください。
- セルフホストではアプリケーションの状態を自分のマシンに保存します。クラウドモデルや外部ツールには、送信したデータが渡ります。任意の[キー管理機能](docs/keychain.md)にはマスターキーが必要で、ワークスペース全体やチャット履歴は暗号化されません。

- ランタイムロックが有効な場合、古い記録や不正な記録を含む既存のロックパスがあると起動を拒否します。クラッシュ後は起動や保守の前に[オフラインでの管理者による削除](docs/multi-user/operator-recovery.md#existing-runtime-locks)が必要な場合があります。所有者が稼働している可能性がある間はロックを削除しないでください。

## ドキュメント

以下の詳細ドキュメントは英語です。

- [使い始める](docs/getting-started.md) — インストール、最初のチャット、認証、永続化、アップグレード
- [設定](docs/configuration.md) — 設定項目、パス、プロバイダー、SSH ツール、環境の上書き
- [Web UI](docs/web-ui.md#chat-and-status-surfaces) — チャット、ワークスペース、エディター、ターミナル、ビューアー
- [ドキュメント索引](docs/README.md) — 運用、連携、開発、アーキテクチャ

## コントリビューション

作業項目とバグ報告は **[GitHub Issues](https://github.com/rcarmo/piclaw/issues)** で管理されています。

- [作業項目またはバグ報告を開く](https://github.com/rcarmo/piclaw/issues/new?template=workitem.md)
- [質問する](https://github.com/rcarmo/piclaw/issues/new?template=question.md)
- [プロジェクトボードを見る](https://github.com/users/rcarmo/projects/13)

問題の報告には issue テンプレートを使ってください。コードを変更する場合は[開発ガイド](docs/development.md)と[リポジトリの作業手順](AGENTS.md)を読み、プルリクエストで提出してください。

## クレジット

- [pi.dev](http://pi.dev) — PiClaw が使用する Pi コアの提供
- [rcarmo/vibes](https://github.com/rcarmo/vibes) — PiClaw のオリジナル UX デザイン
- [qwibitai/nanoclaw](https://github.com/qwibitai/nanoclaw)
- [earendil-works/pi](https://github.com/earendil-works/pi)
- [davebcn87/pi-autoresearch](https://github.com/davebcn87/pi-autoresearch) — Tobi Lutke と David Cortés による自律実験ループ（現在は `rcarmo/piclaw-addons` の autoresearch アドオンが担っています）
- [nicobailon/visual-explainer](https://github.com/nicobailon/visual-explainer) — Nico Bailon による視覚的な成果物の生成スキルの考え方、プロンプトのワークフロー、テンプレートパターン（改変して利用。元のプロジェクトは同梱していません）

> [!NOTE]
> PiClaw は [pi.dev](https://pi.dev) と**直接の提携関係にはありません**。Pi コアを基に、独自のランタイム、ツール、UI 層を追加した派生作品です。

## ライセンス

[MIT](LICENSE)
