# pi-gui 作業引き継ぎ（検証後の現状）

更新: 2026-11-18
対象: github/（upstream commit faf8edd6）。コミット・push・ブランチ変更はしていない。
この文書は実行結果と未完了事項を区別する。作業方針は ../AGENT.md と AGENTS.md、検品手順は .agents/skills/review-pi-gui-fork-work/SKILL.md を参照する。

## 1. 作業範囲

日本語ロケール、身元情報ガード、Windows での検証基盤、および再発防止の文書を未コミットで修正中。更新確認ボタンとアプリ内自動更新には着手していない。前回の「差分は6パスだけ」という記述は現在は無効。必ず git status --porcelain で全量を取り直す。

主な変更:

- apps/desktop/src/i18n/messages/ja.ts と catalog.ts: 日本語を登録。英語の通常キー240件に対応する。en.ts と zh-CN.ts にエンドポイント例の句読点キーを追加。
- apps/desktop/src/features/settings/settings-custom-endpoints-section.tsx: 末尾句読点を翻訳キーに移した。
- scripts/check-identity.mjs と同テスト: 追跡済みおよび ignore 対象外の未追跡ファイルを検査。既知の上流連絡先は配布設定3ファイル内だけ情報扱いにする。
- package.json: 身元情報検査を check の先頭に置き、回帰テストを test:guards に含めた。
- .gitignore: ローカル配布設定を除外。除外した設定は自動で読み込まれず、配布コマンドの明示的な指定が別途必要。
- .prettierrc.json と .prettierignore: Windows の CRLF 展開と symlink 代替ファイルに対応。
- .gitattributes: 追跡済みの拡張機能ブラウザバンドル5件を LF でチェックアウトし、バイト比較を Windows でも成立させる。
- scripts/check-renderer-boundary.mjs、check-workspace-typechecks.mjs と関連テスト: Windows のパス区切りを正規化。
- packages/catalogs/src/node/atomic-write.ts: Windows の一時的な rename 失敗を限定して再試行。
- apps/desktop/electron/persistence/atomic-file-write.ts: Windows で読取中の対象を消さず、競合時は OS の File.Replace を用いる。PowerShell が使えない場合は旧ファイルを保持して失敗を返す。
- apps/desktop/electron/platform/files/git-review.ts: Git for Windows が解釈する /dev/null に変更し、専用一時ディレクトリの EBUSY を限定再試行。
- apps/desktop/electron/workbench/checkpoint-store.ts: 私有 spool のバイト列を Git fast-import にまとめ、逐次 hash-object の大規模 capture 遅延を解消。専用一時ディレクトリの EBUSY を限定再試行。
- apps/desktop/tests/unit の関連 fixture: Git 改行設定、Windows のファイル名・junction・実行ビット制約を明示。
- apps/desktop/tests/helpers/electron-app.ts と tests/core/review-scopes.spec.ts: Windows checkout ID のセレクター解釈と Bash 専用の端末コマンドを修正。
- examples/desktop-extensions/github/source.ts と pr-review/integration.test.mjs: Windows の実行可能 fixture を修正。
- apps/desktop/scripts/verify-linux-release.test.mjs: Windows では Git Bash を Git の実行パスから見つけて実行。
- ../AGENT.md、AGENTS.md、apps/desktop/src/i18n/AGENTS.md、docs/ci-baseline.md、検品スキル: 検証の既定を更新中。

## 2. 実行済みの検証

- corepack enable: Windows の Node インストール先への書き込みが EPERM。以後は corepack pnpm 10.25.0 を使用。
- pnpm install --frozen-lockfile 相当: 成功。固定 lockfile で依存を導入。
- node scripts/check-identity.mjs: 成功。798ファイルを走査、既知の上流連絡先3件を情報表示、unexpected 0件。
- node --test scripts/check-identity.test.mjs: 成功、13/13。
- node scripts/new-locale.mjs --check ja: 成功。ただしこれは英語と完全一致する値の報告で、翻訳品質の証明ではない。
- pnpm format:check、lint、check:architecture、typecheck: 直近の全体 `pnpm check` で成功。文書編集後の format:check も終了コード0。
- pnpm test:guards: 直近の全体 `pnpm check` で成功、133/133。
- pnpm --filter @pi-gui/catalogs test: Windows の再試行修正後は31/31成功。
- pnpm test:extension-examples: 5例のテストと5件の build:check がすべて成功。
- pnpm test:release-helpers: Git Bash 修正後に27/27成功。
- pnpm test:desktop-unit: 単体再実行で423成功、4スキップ、失敗0。4スキップは Windows で作れない病的ファイル名・無効 UTF-8 名、FIFO、およびこの環境で権限のないファイル symlink。cross-platform 部分と junction によるディレクトリ越境は実行した。
- pnpm check: 2026-11-18 の全体再実行は終了コード0。identity、format、lint、architecture、typecheck、guards、catalogs、driver 206件、extension-ui 9件、拡張機能の例、release helper 27件、desktop unit 423成功・4スキップまで完了。
- 実 Electron Settings の日本語エンドポイント文は対象 Core 3/3で確認。macOS/Linux、署名済み配布物、実プロバイダ会話は未実施。
- `pnpm --dir apps/desktop build`: 終了コード0。Core 4ファイル13件の初回実行は12成功・1失敗。失敗した checkout 切替テストは Windows パスを CSS 属性セレクターへ直接挿入し、さらに Bash の `printf` を PowerShell 端末で呼ぶテスト側の問題だった。補助関数とテストを修正し、該当1件の再実行は終了コード0（1成功）。残り12件は修正前の実行結果であり、4ファイル全体の再実行は未実施。

成功した個別コマンドを、未実施の全体チェックの成功と読み替えない。

## 3. 身元情報ガードの範囲と限界

検出するもの: 許可外メール、個人ホームパス、既知形式の秘密鍵・APIキー、日本語で氏名や住所を明示したラベル、ハイフン区切りの電話番号、一部の内部ホスト、URL内認証情報、改行で分割した GitHub トークン、.env 系ファイル内の一般的な秘密値。検出値は CLI に出さず、ファイル・行・分類だけを報告する。

対象: Git の追跡済みと ignore 対象外の未追跡ファイル。読み取り不能、UTF-8 として解読不能、NUL を含むテキスト候補は失敗とする。ignore 対象、Git 履歴の author/committer、自由文の日本語の氏名・住所、任意のエンコードや未知の秘密形式、配布成果物は保証しない。clean は個人情報ゼロの証明ではない。

## 4. 日本語ロケール

通常キーは en.ts と同じ240件。プレースホルダの機械照合は差異0件。カスタムエンドポイント説明は、コード表示を挟んだ日本語の語順と末尾句読点を修正し、実 Electron Settings の対象 Core 3/3で確認した。日本語以外の Settings、タイムライン、composer、サイドバー、Review、Electron main は今回の翻訳範囲外。画面全体の表示とレイアウトは未確認。

## 5. 配布主体の切り替え

現行の apps/desktop/electron-builder.yml には upstream の maintainer、publish owner、copyright があり、apps/desktop/package.json には upstream の author と homepage が残る。verify-release-config.mjs は元の YAML を、verify-linux-release.sh は実際の Debian 成果物の maintainer と homepage を固定値で検証する。electron-builder.local.yml を .gitignore するだけでは切り替わらない。配布主体を変える際は設定の読み込み方法、パッケージ metadata、検証期待値、最終成果物を一体で扱う。これは未実装。

## 6. 計測と未再検証の項目

旧実装の Windows 合成500ファイル初回約53.8秒という前担当の値は、計測スクリプトがなく再現していない。今回の同一テストでは fast-import 化後に約0.9〜1.4秒、合成2,000ファイルの延長上限では約2.2〜2.6秒を観測した。実利用環境の性能保証ではない。Noto Sans JP の存在・描画・ライセンスは再検証していない。

## 7. 次に行うこと

1. Windows PowerShell が制限された端末で atomic replace の失敗時保持を確認する。今回の実機では連続読取テスト30回の置換で欠落0件。
2. CI の Linux/macOS でファイル symlink・POSIX mode・FIFO を含む既存テストの結果を確認する。Windows の4スキップをこの環境で通過した扱いにしない。
3. ガードの NUL・base64 等の限界と fixture 例外を再評価し、必要なら狭い回帰テストを追加する。
4. 配布主体の切り替えを別作業として設計し、設定の読み込みと成果物検証を揃える。更新ボタン・自動更新には、別途明示的に着手するまで進まない。
