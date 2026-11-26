# pi-gui 作業引き継ぎ

作業を再開する際は、[このフォークの作業範囲](docs/development/fork-boundaries.md) とルートの [AGENTS.md](AGENTS.md) を確認する。

- [Claude Code での再開手順](docs/development/claude-handoff.md) に、Windows の起動コマンドと初回確認の指示を用意している。
- 追加機能の参照コードと取得元の一覧は、公開対象外のローカル試験資料に記録している。参照用クローンや試験ログは、このリポジトリには含まれない。
- [開発進捗](docs/development/progress.md) に、現在の範囲、採否、残件、次の実装順をまとめている。
- [開発・検品の進め方](docs/development/workflows.md) から、検品、機能確認、依存更新、Windows 配布の手順を参照できる。
- [追加9項目の実装ループ](docs/development/pre-release-feature-loops.md) に、④の前に進める作業順、完了条件、着手前の判断をまとめた。A と B の結果、C の実装済み範囲、次の判断点は [追加機能の進捗](docs/development/progress.md#追加機能の進捗) を参照する。
- [評価手順](docs/development/evaluation.md) から、GUI 性能や Pi の推論品質を単独で計測できる。
- [次の枠での再開手順](docs/development/progress.md#次の枠での再開手順) に、再開時に確認する対象と残件を記録している。

## 公開先の現在地

利用者指定の [pi-gui-ja-base](https://github.com/shijun537/pi-gui-ja-base) の main にソース・紹介ページ・利用案内・Pi 導入・検証再開プロンプトを反映済み。候補875ファイルとの Git ツリー一致と上流履歴を確認した。紹介ページの CI は成功したが Pages の deploy は skipped で、Web の配信は初期設定待ち。初回公開ソースに対する GitHub CI では、Ubuntu の新規固定依存導入と pnpm check、導入案内・開発ランチャー・版整合性・配布設定の検査が成功しました。Windows のディレクトリ形式パッケージ作成と同梱ランタイム依存の検査も成功しました。制限付きローカル Windows の失敗とは別環境の結果です。macOS の Core と CI 全体の最終合格、選択ありのアンインストールや実クリップボードの確認を兼ねるものではありません。 アプリ全体の CI は別途実行中。最新の結果は [公開記録](docs/development/oss-publication.md#公開先への反映結果) を確認する。

## 再開する作業

- **2026-11-26 の利用者指示により OSS のソース公開を最優先する。** 公開対象の差分整理、ファイルと公開対象履歴の混入確認、再現手順と README の整備を先行する。未検証・既知の問題・試作だけの結果を明記し、Windows 正式配布の全残件をソース公開の前提にはしない。 [公開準備](docs/development/windows-release-plan.md#最優先oss-のソース公開) · [README](README.md)
- push までの計画と実行結果は [OSS 公開の実行記録](docs/development/oss-publication.md) にまとめた。公開先は利用者指定の [pi-gui-ja-base](https://github.com/shijun537/pi-gui-ja-base)。未完了検証を明記した開発中ソースの公開と push は指示済み。元の main と未コミット差分を保持し、上流履歴を残した公開候補から反映する。
- 日本語の紹介ページ、利用条件・プライバシー・ライセンス、[Pi 本体と GUI の導入](docs/getting-started.md) を整備した。検証再開時は [停止箇所の一覧](docs/development/validation-handoff.md) と [貼り付け用プロンプト](docs/development/validation-resume-prompt.md) を使う。サイトの公開状態は [紹介ページの公開記録](docs/development/website-publication-plan.md) で確認する。
- 各計画の実装は既存の担当チャットで継続する。採否判断を待つ間も、独立した作業は並行して進める。03〜06のチャットは保持し、各計画の完了時に開発進捗へ実施内容・検証結果・引き継ぎ事項を記録してから、利用者にアーカイブを案内する。 [担当計画](docs/development/windows-release-plan.md#残りの実装計画と担当スレッド)
- 計画02は非公開更新試験まで完了。03は限定した送信先照合の採否、04は実クリップボードでの画像・テキスト貼り付け、05は保護ソフトの検出詳細と選択ありのアンインストール、06は独立版の名称・公開先などが残る。最終配布候補は採用構成の確定後に作成する。 [最新の状態](docs/development/progress.md)

- Windows の起動画面とサイドバーは利用者確認済み。右ペインのターミナル、ファイル選択に渡すタイトル、通知文も確認した。フォルダ不要のチャットと「プロジェクトで続ける」は、合成モデルと実 Electron で送信・再起動後の再開・停止・下書き編集・取り消し・引き継ぎ後の元履歴まで確認済み。D は既存の設定を保ち、選ばれたプロジェクトに再起動後に適用する。E の Windows 音声入力は、初回に約3.1 GB の Whisper `large-v3` を取得する方式を利用者が確認し、マイクから下書きへの実装を追加した。C の配布リンクは、配布できる状態になってからランディングページ（LP）と一緒に検討する。 [開発進捗](docs/development/progress.md#次の枠での再開手順)
- 検品済み13ファイルは取り込み単位を確定済み。作業ツリーには別件の未コミット差分が混在しているため、着手前に `git status --short` で照合する。 [確定した取り込み単位](docs/development/fork-review-status.md#確定した取り込み単位)
- Windows のセットアップ版は、デスクトップショートカットの選択を既定オフにし、希望した場合だけ作る方針。選択画面は配布準備で実装・検証する。Linux 検証用の Ubuntu VM はシャットダウン済み。 [ショートカットの仕様](docs/development/windows-release-plan.md#セットアップのショートカット)

## 最新の検証

実行した構成と結果は [開発進捗の検証記録](docs/development/progress.md#最新の検証) を参照する。
