# Claude Code への作業引き継ぎ

Windows の同じ `github` フォルダで再開する。未コミットの変更と新規ファイルも、この作業ツリーに含まれる。別のクローンで再開するときは、引き継ぎ資料と対象の差分がそろっていることを先に確認する。

## 初回起動

PowerShell で `github` フォルダを開き、次を実行する。Claude Code の画面から同じフォルダを開いた場合は、引用符の中の文を最初のメッセージに使える。Windows では `CLAUDE.md` がリンク先の名前だけを含むことがあるため、共通ルールの `AGENTS.md` を明示している。 [Claude Code の起動方法](https://code.claude.com/docs/en/cli-reference)

```powershell
claude 'Pi-GUI の作業を引き継いでください。リポジトリの docs/development/fork-boundaries.md、AGENTS.md、HANDOFF.md、docs/development/claude-handoff.md を読み、初回確認を行って日本語で報告してください。'
```

## 初回確認

1. 上記のファイルを読み、`git status --short` と対象差分を確認する。[開発進捗](progress.md#次の枠での再開手順) で検証済みの範囲と次の作業を確かめ、[検品の管理表](fork-review-status.md#確定した取り込み単位) で検品済みの取り込み範囲を照合する。保存処理や Git レビューなどの既存差分は、今回着手する差分と区別する。
2. 確認できた完了項目、未検証や混在差分、次の実装範囲を報告する。初回はファイルと Git の状態を確認するところまでとし、実装はユーザーの着手指示を受けて始める。
3. 最初の実装対象は [HANDOFF.md](../../HANDOFF.md) の「再開する作業」とユーザーの指示から決める。[実装ループ](workflows.md#実装ループ) に沿って、対象操作の日本語を Windows の実 Electron で重点的に確認する。

その後は残りの既存 UI の日本語化、フォルダ不要のチャット、「プロジェクトで続ける」の順に進める。セットアップは配布準備の独立項目とし、追加機能は合意したものから着手する。 [実装の優先度](windows-release-plan.md#実装の優先度) · [チャットとプロジェクトの仕様](../chat-project-spec.md)

## Windows での検証

PowerShell で `pnpm` が見つからず、依存関係がセットアップ済みの場合は、`github` 直下でリポジトリ内の pnpm を使う。画面の検証では [デスクトップのテスト規則](../../apps/desktop/tests/AGENTS.md) と実装ループを参照する。

```powershell
$env:Path = (Resolve-Path .\node_modules\.bin).Path + ';' + $env:Path
.\node_modules\.bin\pnpm.cmd --version
.\node_modules\.bin\pnpm.cmd check
```

## 次の担当者への更新

実装ループを終えるか途中で交代する際は、[開発進捗](progress.md) に作業範囲、実際に検証した構成と結果、未検証・混在差分、次に最初に行う作業を記録する。再開する作業が変わったときは [HANDOFF.md](../../HANDOFF.md) の「再開する作業」も更新する。過去のチャット全文や認証情報は引き継ぎ資料に含めない。
