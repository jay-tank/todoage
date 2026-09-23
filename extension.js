"use strict";

/**
 * TodoAge - shows the age of TODO/FIXME comments (via `git blame`) inline in the editor,
 * and flags ones older than a configurable threshold as stale.
 *
 * Zero network calls, zero telemetry. Everything is derived locally by shelling out to the
 * user's own `git` binary via `child_process.execFile` (never `exec`, never a shell string -
 * no shell injection surface since we never interpolate paths into a shell command).
 *
 * Deliberate simplification: TODO/FIXME detection uses a bare word-boundary regex
 * (`\b(TAG)\b`, case-insensitive) rather than parsing each language's comment syntax. This
 * keeps the extension language-agnostic at the cost of a small risk of false positives when
 * the word appears inside a string literal. Acceptable for v1.
 *
 * Workspace Trust: running `git blame` inside a workspace folder means the invocation
 * honors that repo's own local `.git/config` (and any `core.*`/`diff.*`/`pager.*` settings
 * it sets). For an untrusted workspace (e.g. a repo the user opened but hasn't reviewed),
 * that's a real surface - so git-blame scanning is entirely gated on
 * `vscode.workspace.isTrusted` (declared as `"limited"` support in package.json) and only
 * starts once the user explicitly grants trust. As defense in depth even in a trusted
 * workspace, every git invocation also runs with `GIT_CONFIG_GLOBAL`/`GIT_CONFIG_SYSTEM`
 * pointed at a null device and `GIT_CONFIG_NOSYSTEM=1`, so global/system git config (which
 * is unrelated to the repo itself and shouldn't influence a simple blame read) can't affect
 * the call either.
 */

const vscode = require("vscode");
const { execFile } = require("child_process");
const path = require("path");

const DEBOUNCE_MS = 900;

// Null-device path, used to neutralize global/system git config for every git invocation
// (defense in depth on top of the Workspace Trust gate below - see file header comment).
const NULL_DEVICE = process.platform === "win32" ? "\\\\.\\NUL" : "/dev/null";
const HARDENED_GIT_ENV = Object.assign({}, process.env, {
  GIT_CONFIG_GLOBAL: NULL_DEVICE,
  GIT_CONFIG_SYSTEM: NULL_DEVICE,
  GIT_CONFIG_NOSYSTEM: "1",
  // Don't let git opportunistically rewrite the index while we only read.
  GIT_OPTIONAL_LOCKS: "0",
});

/** @type {vscode.TextEditorDecorationType | undefined} */
let normalDecorationType;
/** @type {vscode.TextEditorDecorationType | undefined} */
let staleDecorationType;

/** Map<string uri, NodeJS.Timeout> - pending debounced re-scan timers per document. */
const debounceTimers = new Map();

/** Map<string uri, boolean> - tracks documents we've already attempted a scan for, purely
 * to avoid redundant work; not strictly required but keeps re-activation scans cheap. */

function createDecorationTypes() {
  normalDecorationType = vscode.window.createTextEditorDecorationType({
    after: {
      color: new vscode.ThemeColor("editorCodeLens.foreground"),
      margin: "0 0 0 1em",
    },
  });
  staleDecorationType = vscode.window.createTextEditorDecorationType({
    after: {
      color: "#e69500",
      fontWeight: "bold",
      margin: "0 0 0 1em",
    },
  });
}

function disposeDecorationTypes() {
  if (normalDecorationType) {
    normalDecorationType.dispose();
    normalDecorationType = undefined;
  }
  if (staleDecorationType) {
    staleDecorationType.dispose();
    staleDecorationType = undefined;
  }
}

function getConfig() {
  const cfg = vscode.workspace.getConfiguration("todoAge");
  const staleDays = cfg.get("staleDays", 90);
  const tags = cfg.get("tags", ["TODO", "FIXME"]);
  return { staleDays, tags };
}

function buildTagRegex(tags) {
  const validTags = (Array.isArray(tags) ? tags : [])
    .filter((t) => typeof t === "string" && t.trim().length > 0)
    .map((t) => t.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (validTags.length === 0) {
    return null;
  }
  return new RegExp("\\b(?:" + validTags.join("|") + ")\\b", "i");
}

/**
 * Run `git blame --porcelain -L <line>,<line> -- <file>` for a single line and resolve the
 * commit's author-time (unix seconds), or null if the line has no meaningful age (not a git
 * repo, file not tracked, or the line has uncommitted local changes - i.e. the all-zero
 * commit hash).
 *
 * We use `git blame --porcelain` (rather than `git log -L`) because its output is simple to
 * parse for a single field (`author-time`) and it reliably reports the all-zero hash for
 * uncommitted lines, which is exactly the "skip gracefully" signal we need.
 *
 * @param {string} filePath absolute path to the file on disk
 * @param {string} cwd the workspace folder to run git in
 * @param {number} lineNumber 1-based line number
 * @returns {Promise<number|null>}
 */
function getLineAuthorTime(filePath, cwd, lineNumber) {
  return new Promise((resolve) => {
    const relPath = path.relative(cwd, filePath);
    if (!relPath || relPath.startsWith("..")) {
      resolve(null);
      return;
    }
    execFile(
      "git",
      // `-c core.fsmonitor=` stops a repo-local fsmonitor hook from being executed.
      ["-c", "core.fsmonitor=", "blame", "--porcelain", "-L", `${lineNumber},${lineNumber}`, "--", relPath],
      { cwd, timeout: 5000, maxBuffer: 1024 * 1024, env: HARDENED_GIT_ENV },
      (error, stdout) => {
        if (error || !stdout) {
          // Not a git repo, git not installed, file not tracked, or blame failed for any
          // other reason - fail gracefully, no age shown, no error surfaced to the user.
          resolve(null);
          return;
        }
        const firstLine = stdout.split("\n", 1)[0] || "";
        const commitHash = firstLine.split(" ", 1)[0] || "";
        if (!commitHash || /^0+$/.test(commitHash)) {
          // Uncommitted / working-tree-only change - no meaningful age yet.
          resolve(null);
          return;
        }
        const match = stdout.match(/^author-time (\d+)$/m);
        if (!match) {
          resolve(null);
          return;
        }
        resolve(parseInt(match[1], 10));
      }
    );
  });
}

function formatAgeText(days, tagLabel) {
  const unit = days === 1 ? "day" : "days";
  return ` (${tagLabel}: ${days} ${unit} old)`;
}

/**
 * Scan a document for tag matches and render age decorations on the given editor.
 * @param {vscode.TextEditor} editor
 */
async function scanEditor(editor) {
  if (!editor || !normalDecorationType || !staleDecorationType) {
    return;
  }
  const document = editor.document;
  if (document.uri.scheme !== "file") {
    return;
  }

  if (!vscode.workspace.isTrusted) {
    // Workspace Trust gate: git blame honors repo-local git config, so we don't invoke
    // git at all until the user has explicitly trusted this workspace. See file header.
    editor.setDecorations(normalDecorationType, []);
    editor.setDecorations(staleDecorationType, []);
    return;
  }

  const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
  if (!workspaceFolder) {
    // No workspace folder open for this file - nothing to blame against reliably.
    editor.setDecorations(normalDecorationType, []);
    editor.setDecorations(staleDecorationType, []);
    return;
  }

  const { staleDays, tags } = getConfig();
  const tagRegex = buildTagRegex(tags);
  if (!tagRegex) {
    editor.setDecorations(normalDecorationType, []);
    editor.setDecorations(staleDecorationType, []);
    return;
  }

  const matchingLines = [];
  for (let i = 0; i < document.lineCount; i++) {
    const lineText = document.lineAt(i).text;
    const match = lineText.match(tagRegex);
    if (match) {
      matchingLines.push({ lineIndex: i, tag: match[0].toUpperCase() });
    }
  }

  if (matchingLines.length === 0) {
    editor.setDecorations(normalDecorationType, []);
    editor.setDecorations(staleDecorationType, []);
    return;
  }

  const cwd = workspaceFolder.uri.fsPath;
  const filePath = document.uri.fsPath;

  const results = await Promise.all(
    matchingLines.map(async ({ lineIndex, tag }) => {
      const authorTimeSec = await getLineAuthorTime(filePath, cwd, lineIndex + 1);
      if (authorTimeSec === null) {
        return null;
      }
      const ageMs = Date.now() - authorTimeSec * 1000;
      const ageDays = Math.max(0, Math.floor(ageMs / (1000 * 60 * 60 * 24)));
      return { lineIndex, tag, ageDays };
    })
  );

  // Guard against the editor having been closed/changed while we awaited git blame.
  if (editor.document.isClosed || editor.document.version !== document.version) {
    return;
  }

  const normalRanges = [];
  const staleRanges = [];

  for (const result of results) {
    if (!result) continue;
    const { lineIndex, tag, ageDays } = result;
    const line = document.lineAt(lineIndex);
    const range = new vscode.Range(line.range.end, line.range.end);
    const decoration = {
      range,
      renderOptions: {
        after: {
          contentText: formatAgeText(ageDays, tag),
        },
      },
    };
    if (ageDays > staleDays) {
      staleRanges.push(decoration);
    } else {
      normalRanges.push(decoration);
    }
  }

  editor.setDecorations(normalDecorationType, normalRanges);
  editor.setDecorations(staleDecorationType, staleRanges);
}

function scheduleScan(document) {
  if (!document || document.uri.scheme !== "file") {
    return;
  }
  const key = document.uri.toString();
  const existing = debounceTimers.get(key);
  if (existing) {
    clearTimeout(existing);
  }
  const timer = setTimeout(() => {
    debounceTimers.delete(key);
    for (const editor of vscode.window.visibleTextEditors) {
      if (editor.document === document) {
        scanEditor(editor);
      }
    }
  }, DEBOUNCE_MS);
  debounceTimers.set(key, timer);
}

function scanImmediately(editor) {
  if (!editor) return;
  const key = editor.document.uri.toString();
  const existing = debounceTimers.get(key);
  if (existing) {
    clearTimeout(existing);
    debounceTimers.delete(key);
  }
  scanEditor(editor);
}

function clearAllDebounceTimers() {
  for (const timer of debounceTimers.values()) {
    clearTimeout(timer);
  }
  debounceTimers.clear();
}

/** @param {vscode.ExtensionContext} context */
function activate(context) {
  createDecorationTypes();

  // Initial pass over whatever is already visible when the extension activates.
  for (const editor of vscode.window.visibleTextEditors) {
    scanImmediately(editor);
  }

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((document) => {
      for (const editor of vscode.window.visibleTextEditors) {
        if (editor.document === document) {
          scanImmediately(editor);
        }
      }
    }),

    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor) {
        scanImmediately(editor);
      }
    }),

    vscode.window.onDidChangeVisibleTextEditors((editors) => {
      for (const editor of editors) {
        scanImmediately(editor);
      }
    }),

    vscode.workspace.onDidChangeTextDocument((event) => {
      scheduleScan(event.document);
    }),

    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("todoAge")) {
        for (const editor of vscode.window.visibleTextEditors) {
          scanImmediately(editor);
        }
      }
    }),

    // Workspace Trust gate lifts: scan everything visible now that git may run.
    vscode.workspace.onDidGrantWorkspaceTrust(() => {
      for (const editor of vscode.window.visibleTextEditors) {
        scanImmediately(editor);
      }
    }),

    vscode.workspace.onDidCloseTextDocument((document) => {
      const key = document.uri.toString();
      const timer = debounceTimers.get(key);
      if (timer) {
        clearTimeout(timer);
        debounceTimers.delete(key);
      }
    })
  );
}

function deactivate() {
  clearAllDebounceTimers();
  disposeDecorationTypes();
}

module.exports = { activate, deactivate };
