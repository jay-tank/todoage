# Changelog

## 0.1.2

- Source code is now public on GitHub: https://github.com/jay-tank/todoage. Added repository, homepage and issue-tracker links to the listing. No behavior change.

## 0.1.1

- Text polish: plain hyphens instead of em dashes in the description, README and messages. No behavior change.

## 0.1.0 - Initial release

- Detect `TODO`/`FIXME` comments (configurable tags) via a language-agnostic word-boundary match.
- Show each match's age inline, computed from `git blame` data for that line.
- Flag comments older than a configurable threshold (default 90 days) as stale with a distinct color.
- Live-reload configuration changes (`todoAge.staleDays`, `todoAge.tags`) without reloading the window.
- No network calls, no telemetry - everything runs locally against the workspace's own git history.
- Workspace Trust aware: no `git` invocation in untrusted workspaces; annotations start automatically once trust is granted. Global/system git config is ignored for every blame call.
- Every `git blame` call also passes `-c core.fsmonitor=` (a repo-local fsmonitor hook can't run) and sets `GIT_OPTIONAL_LOCKS=0`.
