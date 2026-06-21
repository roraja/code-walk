# Code Walk

Browse **code walks** — notebook-style, step-by-step walkthroughs of execution
paths — directly in the VS Code sidebar.

A code walk is an ordered sequence of **cells**, where each cell focuses on a
meaningful chunk of execution. The sidebar shows a clear, readable
**explanation** of each step (never raw code) while the matching source is
highlighted in the editor:

- A plain-language **explanation** of what happens at that step (with optional
  sub-steps for a guided, one-concept-at-a-time walkthrough)
- The **variable state** at that point (created / modified / read)
- The **call stack** (click a frame to jump to it)
- **Branch options** when execution can fork down multiple paths
- A **file reference** to open the corresponding code in the editor

This is a lightweight, **standalone** extension: it reads walks straight from
`.codewalk.json` files on disk. No database, AI provider, or server is required
at runtime — the walks are authored separately (by AI agents using the bundled
skills, or by hand).

## Features

- **Code Walk panel** — a clean, React-based sidebar (shadcn-inspired UI) with a
  progress bar, sticky navigation, an explanation-first layout, variable diffs,
  and a clickable call stack. The panel shows clear text, not code.
- **Editor sync** — navigating cells opens the source file and highlights the
  cell's lines (and the focused sub-step line), keeping code in the editor where
  it belongs.
- **Branch-aware navigation** — choose a path at branch points; "Prev" retraces
  your exact route.
- **Keyboard navigation** — `↑`/`↓` or `j`/`k` to move between cells.
- **Install AI Skills** — one command to install the Claude / Copilot skills
  that author and enrich code walks.

## Code walk file formats

Walks live under `.vscode/code-graph/codewalks/` in your workspace:

**V1 — single file:**

```
.vscode/code-graph/codewalks/<walk-id>.codewalk.json
```

**V2 — multi-file directory:**

```
.vscode/code-graph/codewalks/<walk-id>/
  manifest.codewalk.json
  cell-0.json
  cell-1.json
  ...
```

Both formats are read transparently.

## Commands

| Command | Description |
|---------|-------------|
| `Code Walk: Open Code Walk` | Pick and open a walk from the workspace |
| `Code Walk: Next Cell` / `Previous Cell` | Step through the walk |
| `Code Walk: Refresh` | Reload the current walk from disk |
| `Code Walk: Install AI Skills (Claude & Copilot)` | Install the authoring skills |
| `Code Walk: Show Output Log` | Open the diagnostics output channel |

## Authoring walks with AI

Run **Code Walk: Install AI Skills** to install the bundled skills to
`~/.claude/skills/` and/or `~/.github/copilot-instructions.d/`:

- `codegraph-code-walk` — interactive walkthrough authoring
- `codegraph-codewalk-populate` — create a walk's cells from a scenario
- `codegraph-codewalk-enrich` — add narrative, variable state, and call stacks
- `codegraph-codewalk-podcast` — generate podcast-style narration

Then ask your AI assistant to create or enrich a code walk for a scenario.

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `codewalk.autoOpenCell` | `true` | Open and highlight the source file when navigating cells |

## License

MIT
