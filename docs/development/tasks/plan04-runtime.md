# 計画04：Electron・依存関係・CI

2026-11-26。共有ソースは Pi `1.4.0`、Electron `37.10.3`。Electron `44.11.6` とクリップボードの移行は専用コピーだけで検証し、取り込みを保留している。[共通計画](../windows-release-plan.md#pi-gui-04electron-更新候補と依存関係) · [中断した検証](../validation-handoff.md)

## 着手条件と完了条件

着手時に現在の Git 差分、Pi・Electron・ロックファイル、担当別の採用状況を照合する。Pi 本体と既存ユーザーデータは変更しない。検証には専用プロファイルと合成データを使う。

Electron の採用完了には、同じ候補のセットアップ・ポータブル起動、日本語、内蔵端末、同梱依存、OS の実際の画像・テキスト貼り付けを確認し、採用構成を計画05へ渡す。CI の完了条件は当該コミットの必要なジョブすべての成功。個別ジョブの成功と全体の成功は区別する。

## 観測：Electron 候補

既存の専用コピーでは、非同期 Clipboard API と画像読み取り IPC への移行後、型検査・`pnpm check`、合成データによる開発版の実 Electron 3件・配布ビルド2件、同梱依存検査に成功した記録がある。今回これらの試験を再実行していない。

Windows が試験用ウィンドウステーションの作成を拒否したため、OS 経由の Ctrl+V は未確認。通常のクリップボード内容を読み出す検証へ切り替えず、ダミーデータだけを使える専用 OS ユーザーまたは試験環境で残りを確認する。画像データが貼り付けイベントに含まれない場合の非同期読み取り、テキストの選択範囲への挿入、添付の重複防止を対象にする。計画05は現行構成で先行できる。

## 観測：公開後の CI

| 対象コミット・CI                                                                               | Ubuntu baseline・Windows directory 包装 | macOS Core                                                                                      | Linux AppImage | 全体    |
| ---------------------------------------------------------------------------------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------- | -------------- | ------- |
| [初回 CI 45753637314](https://github.com/shijun537/pi-gui-ja-base/actions/runs/45753637314)    | 成功                                    | shard3 は80件成功後、結果アップロードの `CreateArtifact ETIMEDOUT` でジョブ失敗。他3 shard 成功 | 失敗           | failure |
| [26b207・CI 45754492724](https://github.com/shijun537/pi-gui-ja-base/actions/runs/45754492724) | 成功                                    | 全4 shard と集約が成功                                                                          | 失敗           | failure |
| [bdf6cd・CI 45755559065](https://github.com/shijun537/pi-gui-ja-base/actions/runs/45755559065) | 成功                                    | shard1 は82件成功・1件失敗。他3 shard 成功、集約失敗                                            | 失敗           | failure |

最新の Core 失敗は `extension-view-links.spec.ts:129`。別スレッドのタイトル表示の検査は通過したが、拡張フレームが出す成功の console メッセージを15秒以内に観測できず、配列は空だった。初回のアップロード障害とは別の失敗である。

## Linux 包装：原因候補と用意した差分

観測した Linux ジョブは Ubuntu `26.04.1`、electron-builder `26.8.1`、AppImage ツールセット `1.0.2`。デスクトップのビルド後、mksquashfs の呼び出しが終了コード1で停止し、ツール同梱の `libm.so.6` から、ホストの basename と libsystemd が必要とする `GLIBC_2.43`・`GLIBC_2.29`・`GLIBC_2.39` を解決できなかった。

上流の [issue 9598](https://github.com/electron-userland/electron-builder/issues/9598) には同じツールセットの basename/libm 不整合があり、[修正 PR143](https://github.com/electron-userland/electron-builder-binaries/pull/143/files) は libm を同梱対象から除外する。[公式リリース appimage 1.0.3](https://github.com/electron-userland/electron-builder-binaries/releases/tag/appimage%401.0.3) がその修正を含む。したがって、製品や Pi の処理よりも、包装用ツールのライブラリ混在が今回のエラーを説明する有力な原因候補である。実際の Linux 包装が通るまでは確定しない。

専用コピーに、既存の app-builder-lib パッチへツールセット `1.0.3` と公式アセットの SHA-256 を固定し、ロックファイルのパッチハッシュを連動させる2ファイルの候補を用意し、統合担当へ渡した。担当による共有実装の直接編集は行っていない。既存パッチ、依存の版、Pi、Electron、CI の検査・実行環境・必須ジョブは変更しない。候補を含む CI の結果は未取得。

固定対象 `appimage-tools-runtime-20251108.tar.gz` の公式 release API の digest は `84021a78ee214ae6fd33a2d62a92ba25542dd10bc86bf117a9b2d0bba44e7665`。差分の適用検査、内部パッチ適用、固定版とチェックサムが取得関数へ渡ること、既存の外部ツール指定の保持、ロックファイルがパッチハッシュだけ変わることを静的・合成検証した。アセット自体の取得は名前解決で失敗し、実バイトの再ハッシュは未実施。ローカル WSL は `E_ACCESSDENIED` で、Linux 実行も未実施。

次の最小確認は、候補だけを適用した専用 Linux 環境で `pnpm install --frozen-lockfile`、`pnpm verify:release-config`、`pnpm --filter @pi-gui/desktop run package:linux` を実行すること。続けて既存の同梱依存検査、AppImage/deb の展開・導入・削除検証、候補 staging を実施する。GLIBC エラーが消えたことだけで包装全体の成功にしない。通常の `pnpm check` と必要な CI ジョブも維持する。

## 最終の修正結果

AppImage修正と拡張リンクの通知順序修正を含む [全体CI](https://github.com/shijun537/pi-gui-ja-base/actions/runs/45801754837) が成功。[macOSの実Electron単体診断](https://github.com/shijun537/pi-gui-ja-base/actions/runs/45801754821) も1件成功。フレームの受信確認後に下書き保存とスレッド切り替えを開始する実装へ変更した。元のassert・timeoutを維持し、同時上限・確認の分離・破棄を単体試験で検証した。以前の失敗と原因調査は以下に履歴として残す。Windowsの実Ctrl+VとElectron44採否は別の未完了項目である。

## 統合後の結果

親が公式AppImageツールセット1.0.3の固定版とchecksum、lock hash更新を共有ソースへ取り込んだ。[修正込みCI](https://github.com/shijun537/pi-gui-ja-base/actions/runs/45758269282) はLinux包装を含め全ジョブ成功。以前のGLIBC停止とは区別する。Pi1.4.0とElectron37.10.3は維持した。

[単体診断](https://github.com/shijun537/pi-gui-ja-base/actions/runs/45758269461) は実行し、スレッド表示が切り替わった後の成功console待ちで失敗を再現した。要求ラベルだけを受け、成功ラベルが届いていない。traceと時系列添付を根拠に、終了順序と観測を調べる段階であり、修正完了とはしていない。

## Core の切り分け

推論として、スレッド選択によるフレームの終了と、成功応答をフレームが受け取って console へ出す処理の競合が考えられる。main はホストアクションの完了後に結果を送信し、フレームは終了時に待機中の処理を拒否する。ログだけでは、製品の応答契約の欠陥、fixture の console 観測の問題、実行環境による順序変化を分けられない。

専用コピーに、当該試験の成功条件・タイムアウトを変えず、合成 fixture の要求・成功・拒否・終了とフレーム切断の順を記録する診断候補を用意した。実 Electron では未実行。次は同じコミット・macOS で当該 spec を単体実行し、診断の時系列と trace を照合する。成功応答を送る前に接続が閉じるなら製品側の契約を調べ、応答後のログ観測だけが欠けるなら fixture を調べる。スキップ、待機時間の延長、単なる再実行だけで解決済みにしない。

## 担当へ渡す再開プロンプト

```text
Pi-GUI 計画04の残件を続けてください。AGENTS.md、HANDOFF.md、fork-boundaries、計画04の担当文書と実際の Git 差分を照合してください。Pi1.4.0と共有Electron37.10.3を保持し、Pi本体・既存設定・実キーを読んだり変更したりしないでください。

Electron44.11.6の非同期Clipboard API修正版は専用コピーで検証済みですが、OS経由の画像・テキストCtrl+Vが未確認で採用保留です。ダミーデータだけを使える専用環境で残件を確認し、同じ配布物とハッシュで結果を記録してください。

公開CIは26b207ではmacOS Core全shard成功、bdf6cdではextension-view-links.spec.ts:129の成功console待ちが失敗しました。初回CIのshard3失敗は80件成功後のartifactアップロードETIMEDOUTです。それぞれ分けて扱い、診断候補とtraceで製品・fixture・環境を切り分けてください。

Linux AppImageはUbuntu26.04.1とappimageツール1.0.2のlibm混在で失敗しています。上流PR143を含む1.0.3へ固定する2ファイル候補があります。公式アセットchecksum、pnpmパッチハッシュ、固定依存導入から実Linux包装・既存の導入削除検証まで確認してください。CIの必須検査や保護設定は緩めないでください。実施・再利用した証拠・推論・未確認を分け、採用可能になった構成だけを計画05へ渡してください。
```
