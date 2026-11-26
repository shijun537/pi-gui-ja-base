# pi-gui 作業の入口

ここには全作業に共通する短い規則と参照先だけを置く。個別タスクの手順や過去の結果を複製しない。ユーザーの後続の指示は、古い手順と引き継ぎより優先する。

## 共通の規則

- 作業範囲はユーザーの依頼で決める。検証中に無関係な問題を見つけても、元の修正へ混ぜず、結果として報告する。
- pi 本体、認証情報、実在の個人情報、ユーザーのセッション履歴や一時成果物は、[このフォークの作業範囲](docs/development/fork-boundaries.md) に従って扱う。
- 変更を共有する前に `pnpm check:identity` を実行する。通過は個人情報が存在しない証明ではない。
- pi-gui の実装境界は [architecture.md](docs/architecture.md) に従う。ユーザーの明示がなければブランチや履歴を変更しない。

## 参照先

- [HANDOFF.md](HANDOFF.md) から現在の進捗、採否、検証結果を確認する。記述は実際の差分と実行結果で確かめる。
- [開発・検品の進め方](docs/development/workflows.md) から作業を選ぶ。ループを作る・変えるときは [ループ設計の基準](docs/development/workflows.md#ループ設計の基準) を参照する。
- [i18n 規則](apps/desktop/src/i18n/AGENTS.md): 日本語ロケールの対象と書き方。
- [README.md](README.md) と [検証基準](docs/ci-baseline.md): 製品、開発環境、共通の検証。
- [ARCHIVE](ARCHIVE/README.md): 過去の検討と検証。現在の作業指示ではない。

ルートの `CLAUDE.md` は、このファイルへのシンボリックリンクとして保つ。
