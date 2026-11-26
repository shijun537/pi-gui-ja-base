# Pi 本体と GUI の導入

この GUI は Pi の SDK を使います。**GUI をソースから起動するだけなら、Pi の CLI を別途グローバルインストールする必要はありません。** GUI の固定依存を導入すると SDK も入ります。CLI をターミナルで単独利用したい場合だけ、後半の手順を使ってください。

## 前提

- Node.js 22.19 以上と、GUI の開発には pnpm 10.25.0。Windows では Git for Windows も用意します。
- 現行の GUI が固定依存で使う Pi は `1.4.0`。CLI を新しく入れても、GUI 内の Pi の版が自動で変わるわけではありません。
- ネイティブ依存のビルドには Windows の C++ ビルドツールが必要になる場合があります。このリポジトリの新規導入は、制限付きの検証環境ではリンク作成拒否で完了できていません。

## GUI を使いたい場合

リポジトリを取得し、そのルートで PowerShell を開きます。README の専用プロファイルの例に従って、アプリ用と Pi 用の保存先を両方指定してください。

```powershell
git clone https://github.com/shijun537/pi-gui-ja-base.git
cd pi-gui-ja-base
corepack pnpm install --frozen-lockfile
$trialProfile = Join-Path ([System.IO.Path]::GetTempPath()) ([guid]::NewGuid().ToString())
$env:PI_APP_USER_DATA_DIR = Join-Path $trialProfile 'app'
$env:PI_CODING_AGENT_DIR = Join-Path $trialProfile 'agent'
corepack pnpm dev
```

認証はアプリのプロバイダー設定から行います。ただし製品版のキー暗号化などは未完了です。最初はダミーキー・合成データで確認し、[セキュリティの制約](../SECURITY.md) と [データの扱い](legal/privacy.md) を読んでください。モデルや外部サービスには別の利用契約・料金が必要な場合があります。

音声入力は Pi 本体の導入とは別に、Whisper 実行部のビルドと初回のモデル取得が必要です。詳細は [README](../README.md#ソースから起動する) を参照してください。

## Pi の CLI も単独で使いたい場合

Pi 公式は公式インストーラーと npm による導入を案内しています。ここでは現在の GUI の確認条件に合わせ、CLI 本体の版を指定する npm の例を示します。npm 方式は推移的な依存関係をすべて固定するものではありません。この作業で既存の CLI を勝手に入れ替えることはしません。

```powershell
node --version
npm --version
npm install -g --ignore-scripts @earendil-works/pi-coding-agent@1.4.0
pi --version
```

プロジェクトのフォルダで `pi` を起動し、対話画面の `/login` から使用するプロバイダーのログインやキー登録を行います。認証情報を Issues やログへ貼らないでください。通常は Pi の既定の保存先を使うため、試験では専用の保存先を指定します。

```powershell
$cliProfile = Join-Path ([System.IO.Path]::GetTempPath()) ([guid]::NewGuid().ToString())
$env:PI_CODING_AGENT_DIR = $cliProfile
pi
```

`pi` が見つからない場合は、新しいターミナルを開き、`npm config get prefix` で表示される実行ファイルの配置先が PATH にあるか確認します。実際のホームパスを不具合報告へそのまま貼らないでください。

## 通信設定について

Pi `1.4.0` の公式文書では、匿名のインストール・更新報告と一部プロバイダーへの属性ヘッダーを `enableInstallTelemetry`、分析への参加を `enableAnalytics` として説明しています。更新確認は別の処理です。現在の文書上の既定は前者が有効、後者が無効です。

試験用 PowerShell の子プロセスで前者を無効にする場合は、起動前に `$env:PI_TELEMETRY = '0'` を指定できます。普段の共有設定を変更するものではありません。これだけで任意のモデル・拡張・GUI 自体のすべての外部通信がなくなるわけではありません。

## 公式の参照先

- [Pi 1.4.0 の公式導入説明](https://github.com/earendil-works/pi/blob/v1.4.0/packages/coding-agent/README.md#getting-started)
- [Pi の公式サイト](https://pi.dev/)
- [Pi 1.4.0 の環境変数](https://github.com/earendil-works/pi/blob/v1.4.0/packages/coding-agent/docs/environment-variables.md)
- [Pi 1.4.0 の設定](https://github.com/earendil-works/pi/blob/v1.4.0/packages/coding-agent/docs/settings.md)

公式手順とローカルに導入済みの Pi `1.4.0` のメタデータを照合して記載しています。この案内を作るために、新たな Pi のインストールやログインを実行したわけではありません。
