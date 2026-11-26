# Windows 版の依存関係の保守

Pi・Electron・採用後の MXC の更新候補を確認し、Windows x64 で動作を確認した組み合わせを配布する。[開発・検品の進め方](workflows.md) の依存更新に使う手順。製品側の Pi 互換方針は [チャットとプロジェクトの追加仕様](../chat-project-spec.md#3-pi-のバージョンに合わせて保守する) を参照する。

## 更新候補を確認してから配布するまで

1. **候補を確認する。** 通常更新は週次を目安に [Pi のリリース](https://github.com/earendil-works/pi/releases)、[Electron のサポート日程](https://releases.electronjs.org/schedule)、採用後は [MXC のリリース](https://github.com/microsoft/mxc/releases) をまとめて確認する。前回から対象候補や採否の条件に動きがなければ、確認までで終える。セキュリティ修正とサポート終了は優先して扱う。公開先のリポジトリでは、既存の [Dependabot 設定](../../.github/dependabot.yml) に npm の更新検知を加える方針。現在の設定は GitHub Actions が対象。 [GitHub の設定資料](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference)
2. **候補ごとに差分を作る。** Pi・Electron・MXC は別々に扱い、関連する Pi パッケージは同じ版にそろえる。Pi の版を変える前に親の `AGENT.md` に従いユーザーに確認する。Pi との互換修正が必要なら `packages/pi-sdk-driver` に収める。
3. **検証する。** 先に更新対象に対応する既存テストで互換性を確認する。不適合を確認した候補は原因を記録し、修正を試すか保留する。採用を検討する状態で共通検査と Windows のパッケージ検証を行う。実際に配布する候補の起動・実機確認は配布手順で行い、同じ成果物を扱う保守の記録からも参照する。性能や推論品質が採否に関わる場合は、条件が一致する評価結果を使う。 [評価手順](evaluation.md) · [Windows 配布の検証](windows-release-plan.md#同じ配布候補で検証をまとめる)
4. **採否と結果を残す。** 更新記録または PR に、対象と変更前後の版、Windows の版、確認結果、残件、採否を記載する。採用時は `pnpm-lock.yaml` を更新差分に含め、配布時に検証済みの Pi・Electron・採用済みなら MXC の版を記載する。確認に失敗した候補は保留し、原因と再確認条件を残す。自動化する範囲は候補の検知とテストまでとし、取り込みと配布はレビュー後に行う。

## 検証

リポジトリのルートで既存の検査を使う。以下は展開済みビルドで確認を終える場合のコマンド。同じ候補をセットアップ版とポータブル版まで検証する場合は、`package:win` と同梱依存の確認を配布手順で行い、ローカルで `package:win:dir` を先に作る作業は省く。CI の必須ジョブはそれぞれの対象範囲で実行される。 [既存 CI](../../.github/workflows/ci.yml) · [Windows 配布診断](../../.github/workflows/windows-release-diagnostic.yml)

```powershell
pnpm install --frozen-lockfile
pnpm check
pnpm --filter @pi-gui/desktop run package:win:dir
pnpm --dir apps/desktop run verify:packaged-runtime-deps:windows
```

- **Pi** は会話の送信・停止・再開、既存の合成セッションの読み込み、選んだプロジェクトフォルダ内でのツール実行を確認する。
- **Electron** はセットアップ版のインストールとポータブル版の展開、起動、端末、同梱のネイティブ依存を確認する。キー保護が組み込まれている構成では、ダミーキーの保存と再起動後の復号も確認する。
- **MXC** を含む構成では、エージェントと子プロセスからキー保管領域と未許可の外部宛先にアクセスできず、登録済みのテスト API はダミーキーで利用できることを確認する。対象 Windows の版と、配布構成での診断データ送信も確認する。 [MXC の診断データ仕様](https://github.com/microsoft/mxc/blob/main/docs/telemetry.md)

現在の採用版と更新候補は [開発進捗](progress.md) を参照する。
