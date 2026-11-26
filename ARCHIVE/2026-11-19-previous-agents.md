# Repo Guidelines

These rules apply for the full session.

## Workflow

- Define success criteria before coding; if unclear, stop and clarify.
- For non-trivial work, plan verification before editing: name the affected user flow, observable result, failure cases, and existing commands that prove them. Start with the checked-in [desktop verification skill](../.agents/skills/verify-pi-gui/SKILL.md) for desktop flows and [baseline checks](../docs/ci-baseline.md) for repository checks.
- Do not create or switch to new branches to start work unless the user explicitly asks; respect the current branch or worktree as intentional.
- Commit in small focused checkpoints; don’t batch unrelated changes.
- Before closing non-trivial implementation work, review the diff for unnecessary abstractions, duplicate paths, unsafe escapes, and obsolete code; simplify within scope and rerun affected checks.
- Record the exit status of every requested check. If a baseline command stops early, run its remaining relevant stages separately and distinguish a pre-existing failure from a regression only when evidence supports that distinction.

## Product

- This repo is building a Codex-style desktop app for `pi`; preserve that product direction.
- Desktop work is not done until it is verified on the real Electron surface, not only by unit tests.
- Transcript/timeline behavior, session correctness, and Codex-style UX are product features, not polish.
- Prefer clean reimplementation over patching around local complexity.

## Safety

- Never delete user session history, cached transcripts, screenshots, or temp artifacts without approval.
- Treat files you didn’t edit as read-only when multiple agents may be working.
- Ask before destructive commands or history rewrites.
- Run `pnpm check:identity` before sharing or committing a diff. It scans tracked and non-ignored untracked files, but its patterns are only a first pass: review Japanese free text, encoded values, Git metadata, ignored files, and packaged artifacts separately. Never print a detected value in evidence.

## Structure

- Prefer path-scoped guidance in nested `AGENTS.md` files over growing this file.
- Follow the ownership and migration guidance in [docs/architecture.md](../docs/architecture.md); target folders are not evidence that a migration is complete.
- Keep the desktop renderer/main/preload boundary tight; avoid broad Node exposure to the renderer.
- Keep `pi-sdk-driver` thin over `pi-mono`; don’t fork or reimplement `pi` runtime behavior unless necessary.

## Source Of Truth

- Root `AGENTS.md` is the repo instruction source of truth.
- Root `CLAUDE.md` should remain a symlink to `AGENTS.md`.

## 作業範囲と完了の基準

1. 実際に少なくとも1回は正常に実行されることを確認してください。シミュレーション環境でのテストは対象外です。
2. 最もシンプルなバージョンから始めてください。コード行数が300行を超えると予想される場合は、その理由を事前に説明する必要があります。
3. レビューは最大2回までとします。それ以降は、「コードが最後まで実行されない」または「データが破損する」という問題のみがブロック対象となります。
4. 時折の繰り返しや手動での修正が必要になることは許容されます。完璧さを追求するわけではありません。
5. 元に戻せる変更については承認は不要です。データの削除、資金の関与、公開につながる変更、または権限の変更のみが承認の対象となります。
6. 新しいルールやレビュー段階を追加する場合は、私の承認を得る必要があり、同時に既存のルールを削除できるかどうかも説明してください。
7. 同じ問題で2回行き詰まった場合は、作業を中断し、3つの簡単な文を使って平易な言葉で私に尋ねてください。問題を回避するための新たな回避策を導入しないでください。
8. 報告の際は、自分が何を行ったか、結果をどのように個人的に検証したか、そして次のステップは何かについてのみ記述してください。ハッシュ値や専門用語は含めないでください。
