<p align="center">
  <img src="icon.png" width="128" alt="TodoAge icon">
</p>

<h1 align="center">TodoAge</h1>

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=jaytankdev.todoage"><img src="https://vsmarketplacebadges.dev/version-short/jaytankdev.todoage.svg" alt="VS Code Marketplace version"></a>
  <a href="https://marketplace.visualstudio.com/items?itemName=jaytankdev.todoage"><img src="https://vsmarketplacebadges.dev/installs-short/jaytankdev.todoage.svg" alt="Installs"></a>
  <a href="https://github.com/jay-tank/todoage/blob/main/LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT"></a>
</p>

<p align="center">
  <b>Install:</b> <a href="https://marketplace.visualstudio.com/items?itemName=jaytankdev.todoage">VS Code Marketplace</a> · <code>code --install-extension jaytankdev.todoage</code> · <b>Source:</b> <a href="https://github.com/jay-tank/todoage">github.com/jay-tank/todoage</a>
</p>

Shows how old each `TODO`/`FIXME` comment is - via `git blame` - and flags stale ones
directly in the editor.

## The problem

Git blame extensions (GitLens and friends) show you who last touched a line and when, but
they don't specifically surface or flag comment age. TODO-listing extensions (Todo Tree and
friends) collect every TODO in your workspace into a list, but they don't show or flag how
old each one is. Nothing on the marketplace combines "this is a TODO" with "this TODO is N
days old, and that's stale" into one inline signal - so stale TODOs accumulate silently,
forgotten in files nobody revisits.

TodoAge fills that specific gap: an inline, per-line age annotation for TODO/FIXME
comments, using data your repo already has (git history), with zero setup.

## How it works

- On activation, and whenever you open or switch to a file, TodoAge scans every line of the
  visible document for a configurable set of tags (default: `TODO`, `FIXME`).
- For each match, it shells out to your locally installed `git` binary
  (`git blame --porcelain -L <line>,<line>`) to find the commit that introduced that line,
  and reads its `author-time`.
- It renders a small inline annotation after the line, e.g. ` (TODO: 214 days old)`, in a
  muted color normally, or a bold orange/warning color if the age exceeds your configured
  `todoAge.staleDays` threshold (default 90 days).
- Edits are debounced (~900ms after you stop typing) and only the changed document is
  re-scanned - not the whole workspace.
- Configuration (`todoAge.staleDays`, `todoAge.tags`) is read live from
  `vscode.workspace.getConfiguration`, so changes apply immediately without reloading the
  window.

- **Workspace Trust:** because `git blame` honors a repo's own local `.git/config`, TodoAge
  does nothing in an untrusted workspace and starts annotating as soon as you trust it. Every
  git call also runs with global/system git config disabled (`GIT_CONFIG_GLOBAL` /
  `GIT_CONFIG_SYSTEM` pointed at the null device, `GIT_CONFIG_NOSYSTEM=1`).

TodoAge makes **zero network calls** and collects **zero telemetry**. Everything runs
locally against your own git history via the `git` binary already on your machine.

## Configuration

| Setting | Type | Default | Description |
| --- | --- | --- | --- |
| `todoAge.staleDays` | number | `90` | Number of days after which a TODO/FIXME comment is considered stale. |
| `todoAge.tags` | string[] | `["TODO", "FIXME"]` | Comment tags to track (case-insensitive). |

## Honest caveats

- **Tag matching is a bare word-boundary regex** (`\bTODO\b`, `\bFIXME\b`, case-insensitive),
  not a per-language comment parser. This keeps the extension language-agnostic with no
  per-language configuration, but it means a string literal that happens to contain the word
  "TODO" will also get an age annotation. Accepted as a small, rare false-positive risk for v1.
- **Only works in git-tracked files with committed history.** If the workspace isn't a git
  repository, or `git` isn't installed, TodoAge simply shows no age annotations - it fails
  silently rather than showing an error.
- **Uncommitted lines show no age.** If a TODO you just typed hasn't been committed yet (or
  is part of an uncommitted change to an existing line), `git blame` reports it as
  unattributed and TodoAge intentionally skips showing an age for it - a TODO you wrote a
  moment ago doesn't have a meaningful "age" yet.

## License

MIT - the full license text is included with the extension.
