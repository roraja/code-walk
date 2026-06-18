---
name: codewalk-populate
description: "Use this skill when the user asks to 'create a code walk', 'populate a code walk',
  'generate code walk cells', 'build a codewalk', 'walk through this code', 'create cells for scenario',
  'codewalk populate', or when they want to create a new .codewalk.json file with notebook-style cells
  that trace an execution path through a codebase. The skill produces a complete CodeWalk JSON file
  with cells, variables, call stacks, and AI explanations."
---

# Code Walk Populate — Create Cell-Based Code Walks

Generate a `.codewalk.json` file with notebook-style cells that trace an execution path through the codebase. Each cell represents a meaningful chunk of execution (entering a function, evaluating a branch, variable assignments, etc.).

## When to Use

- User asks to create/generate/populate a code walk
- User provides a scenario or entry point and wants a step-by-step walkthrough
- User wants to trace a code path and produce browsable cells

## Output File — Two Formats

Code walks support two storage formats. **Prefer v2 (multi-file) for new walks** — it's faster for AI agents to generate (one cell at a time) and less error-prone (no giant JSON to assemble). The reader loads both formats transparently.

### Format V2: Multi-File (PREFERRED for new walks)

Each walk is a **directory** with a manifest and one JSON file per cell:

```
.vscode/code-graph/codewalks/<walk-id>/
  manifest.codewalk.json    ← walk metadata + ordered cell list
  cell-0.json               ← individual cell
  cell-1.json               ← individual cell
  ...
```

#### Manifest file (`manifest.codewalk.json`)

```json
{
  "_format": "codegraph-codewalk-v2",
  "walk": {
    "id": "<kebab-case-id>",
    "name": "<Human-readable name>",
    "description": "<What this walk traces>",
    "scenarioId": "<optional-scenario-id>",
    "cellIds": ["cell-0", "cell-1", "cell-2"],
    "meta": {
      "contributors": [
        {
          "tool": "ai:claude",
          "fieldsPopulated": ["code", "narrative", "state", "callStack", "highlights"],
          "timestamp": "<ISO-8601>"
        }
      ],
      "createdAt": "<ISO-8601>",
      "updatedAt": "<ISO-8601>",
      "tags": ["#tag1", "#tag2"],
      "entryPoint": {
        "filePath": "<path/to/file>",
        "line": 42,
        "functionName": "MyClass::myMethod"
      }
    }
  }
}
```

#### Individual cell file (`cell-0.json`, `cell-1.json`, etc.)

```json
{
  "_format": "codegraph-cell-v1",
  "walkId": "<walk-id>",
  "cell": { /* WalkCell — see below */ }
}
```

**Workflow for v2:**
1. Create the walk directory: `.vscode/code-graph/codewalks/<walk-id>/`
2. Write the manifest first with the ordered `cellIds` array
3. Write each cell as `<cell-id>.json` — one file per cell
4. Cells can be written incrementally (write cell-0, then cell-1, etc.)
5. The reader auto-discovers extra cell files not in `cellIds` (sorted by index)

### Format V1: Single File (legacy, still supported)

One file containing the entire walk with all cells inline:

```
.vscode/code-graph/codewalks/<walk-id>.codewalk.json
```

```json
{
  "_format": "codegraph-codewalk-v1",
  "walk": {
    "id": "<kebab-case-id>",
    "name": "<Human-readable name>",
    "description": "<What this walk traces>",
    "scenarioId": "<optional-scenario-id>",
    "cells": [ /* WalkCell[] — see below */ ],
    "meta": {
      "contributors": [
        {
          "tool": "ai:claude",
          "fieldsPopulated": ["code", "narrative", "state", "callStack", "highlights"],
          "timestamp": "<ISO-8601>"
        }
      ],
      "createdAt": "<ISO-8601>",
      "updatedAt": "<ISO-8601>",
      "tags": ["#tag1", "#tag2"],
      "entryPoint": {
        "filePath": "<path/to/file>",
        "line": 42,
        "functionName": "MyClass::myMethod"
      }
    }
  }
}
```

Both formats are read transparently by the VS Code extension and the CodeGraph core library.

## Data Structure Reference
```

### WalkCell Structure

Each cell in the `cells` array MUST have this shape:

```typescript
interface WalkCell {
  // Required fields
  id: string;              // Unique cell ID, e.g. "cell-0", "cell-1"
  index: number;           // Sequential position (0-based)
  type: CellType;          // One of: 'entry' | 'call' | 'branch' | 'assignment' | 'return' | 'dispatch' | 'block' | 'note'
  code: CodeSlice;         // The source code this cell refers to
  stackDepth: number;      // How deep in the call stack (0 = entry function)
  source: DataSource;      // Who produced this cell
  status: CellStatus;      // One of: 'skeleton' | 'partial' | 'complete' | 'corrected'

  // Optional fields
  narrative?: string;      // Human-readable AI explanation of what happens
  state?: CellState;       // Variable state at the END of this cell
  parentCellId?: string;   // ID of the 'call' or 'entry' cell that spawned this context
  callStack?: CellCallStackFrame[];  // Full call stack at this cell
  confidence?: number;     // 0.0 - 1.0
  corrections?: CellCorrection[];
  steps?: CellStep[];      // Sub-steps for guided focus within the cell (see below)

  // Branching / tree navigation
  nextCellIds?: string[];        // IDs of cells that can follow this one (see Branching section)
  branchOptions?: BranchOption[];  // Describes each branch option for the user to choose
}
```

### BranchOption Structure (for tree-structured walks)

When a cell has multiple `nextCellIds`, it's a **branch point** — the viewer asks the user to choose which path to explore. Each `BranchOption` gives the user enough context to decide.

```typescript
interface BranchOption {
  label: string;           // Short label, e.g. "true — supported type"
  description: string;     // What happens on this path
  condition?: string;      // The condition expression, e.g. "mimeType === 'image/jpeg'"
  pathHint?: 'taken' | 'skipped' | 'error' | 'default';  // Visual hint for the UI
}
```

### nextCellIds Semantics

| `nextCellIds` value | Behavior |
|---------------------|----------|
| Omitted / undefined | Linear navigation — next cell by index |
| `[]` (empty array) | **End cell** — no further navigation |
| `["cell-5"]` (single) | Explicit link to one next cell |
| `["cell-4", "cell-6"]` (multiple) | **Branch point** — viewer shows options, user chooses |
```

### CellStep Structure (Sub-Steps)

Sub-steps break a cell into sequential focus points. When present, the viewer
shows one step at a time — highlighting the `focusLine` strongly while the
overall cell range gets a lighter background. This makes dense cells
easier to understand by guiding the reader through one concept at a time.

**When to use:** Add `steps` whenever a cell has 3+ lines of conceptually
distinct code (e.g., a function body with initialization, a call, a branch,
and a return). Each step should explain ONE line/concept.

```typescript
interface CellStep {
  description: string;     // What this line/concept does
  focusLine: number;       // Line to highlight strongly (1-based, absolute in file)
  focusEndLine?: number;   // Optional end line for multi-line focus (1-based, inclusive)
}
```

**Example:**
```json
{
  "steps": [
    { "description": "Check if the MIME type is supported by this processor", "focusLine": 7 },
    { "description": "Return an error result for unsupported types", "focusLine": 8, "focusEndLine": 12 },
    { "description": "Call resizeImage to process the file", "focusLine": 15 },
    { "description": "Return success with the processed byte count", "focusLine": 16, "focusEndLine": 19 }
  ]
}
```

### CodeSlice Structure

```typescript
interface CodeSlice {
  filePath: string;         // File path (absolute or workspace-relative)
  startLine: number;        // First line (1-based)
  endLine: number;          // Last line (1-based, inclusive)
  text: string;             // Actual source code text
  highlights?: LineHighlight[];  // Lines to emphasize
}

interface LineHighlight {
  line: number;             // Line number (1-based, absolute in file)
  type: 'executed' | 'skipped' | 'branched' | 'assigned' | 'called' | 'returned';
  annotation?: string;      // Short annotation shown next to the line
}
```

### CellState Structure (Variable State)

```typescript
interface CellState {
  scopes: CellScope[];      // Variables organized by scope
  changes?: string[];        // Quick summary, e.g. ["x: 5 → 10"]
}

interface CellScope {
  name: string;             // 'local', 'parameters', 'this', 'closure', 'global'
  variables: Record<string, CellVariable>;
}

interface CellVariable {
  value: string;            // Display value
  type?: string;            // Declared/inferred type
  changed: boolean;         // Did this variable change in this cell?
  action?: 'created' | 'modified' | 'read' | 'unchanged';
  source: DataSource;       // Who provided this value
  rationale?: string;       // Why this value was chosen
}
```

### CellCallStackFrame Structure

```typescript
interface CellCallStackFrame {
  functionName: string;     // Qualified function name
  filePath: string;         // File path
  line: number;             // Line number
  depth: number;            // Stack depth (0 = root)
  cellId?: string;          // Cell ID for this function's entry
}
```

### DataSource Structure

```typescript
interface DataSource {
  tool: string;             // 'ai:claude', 'clangd', 'human', etc.
  agent?: string;           // Specific agent name
  timestamp: string;        // ISO-8601
  confidence: number;       // 0.0 - 1.0
}
```

## Procedure

### Step 1: Identify the Entry Point

Ask the user for:
- The entry function or code path to trace
- The scenario description (what triggers this execution)
- Any specific branches or conditions to follow

### Step 2: Read the Source Code

Read the actual source files to understand the execution path. Follow function calls, branches, and dispatch points. You do NOT need clangd or any static analyzer — read the code directly and use AI understanding.

However, if clangd/IntelliSense data is available, it can speed up call resolution.

### Step 3: Create Cells

For each meaningful chunk of execution:

1. **Entry cells** (`type: 'entry'`): When entering a function — include the signature, parameters, initial state
2. **Call cells** (`type: 'call'`): When calling another function — show the call site and what arguments are passed
3. **Branch cells** (`type: 'branch'`): When evaluating a condition — show the condition and which path is taken
4. **Assignment cells** (`type: 'assignment'`): When important variables are assigned — show the assignment
5. **Return cells** (`type: 'return'`): When returning from a function — show the return value
6. **Dispatch cells** (`type: 'dispatch'`): Virtual dispatch / interface resolution
7. **Block cells** (`type: 'block'`): Group sequential statements for brevity
8. **Note cells** (`type: 'note'`): Pure commentary (summaries, architecture notes)

#### Creating Branch Points (Tree Walks)

When the code has an `if`, `switch`, or other conditional, create a **branch cell** that lets the user explore BOTH paths:

1. Create the branch evaluation cell (type: `'branch'`) — shows the condition being evaluated
2. Set `nextCellIds` to point to the first cell of EACH branch path (e.g., `["cell-4", "cell-6"]`)
3. Add `branchOptions` with a `label`, `description`, and optional `condition` for each path
4. Create cells for BOTH paths — each path should have its own sequence of cells
5. Terminal cells at the end of each path should have `nextCellIds: []`

The manifest's `cellIds` should list ALL cells across ALL branches (flat list). The tree structure is encoded via `nextCellIds` in each cell. Cells for different branches can have any index — they're navigated by ID, not by sequential order.

### Step 4: Populate Each Cell Fully

For each cell, fill in:
- `code`: Read the actual source lines and include them as text
- `narrative`: Write a clear explanation of what happens and WHY
- `state`: Imagine realistic variable values at this point
- `callStack`: Build the full call stack from parent references
- `highlights`: Mark which lines are executed, branched, assigned, etc.
- `steps`: Add sub-steps for cells with 3+ conceptually distinct lines — each step focuses on one line/concept with a `description` and `focusLine`

### Step 5: Save the Files

**V2 (preferred):** Create a directory and write files incrementally:
1. Create directory `.vscode/code-graph/codewalks/<walk-id>/`
2. Write `manifest.codewalk.json` with the walk metadata and `cellIds` array
3. Write each cell as `<cell-id>.json` (e.g., `cell-0.json`, `cell-1.json`)
   - Each cell file has `_format: "codegraph-cell-v1"`, `walkId`, and the `cell` object
4. You can write cells one at a time — no need to assemble a giant JSON

**V1 (still supported):** Write the full walk as a single `.vscode/code-graph/codewalks/<walk-id>.codewalk.json`.

## Cell Type Guidance

| Cell Type | When to Use | stackDepth Change |
|-----------|-------------|-------------------|
| `entry` | First cell of the walk, or entering a function for the first time | New depth level |
| `call` | A function call is made (the called function's body follows) | +1 from caller |
| `branch` | An if/switch/ternary is evaluated | Same as parent |
| `assignment` | Important variable assignment(s) | Same as parent |
| `return` | Returning from a function | -1 (back to caller) |
| `dispatch` | Virtual method / interface resolution | Same as parent |
| `block` | Multiple sequential statements grouped | Same as parent |
| `note` | Commentary, summary, architecture note | Same as parent |

## Example Cell

```json
{
  "id": "cell-3",
  "index": 3,
  "type": "branch",
  "code": {
    "filePath": "src/auth/login.ts",
    "startLine": 58,
    "endLine": 62,
    "text": "const isValid = await bcrypt.compare(password, user.passwordHash);\nif (isValid) {\n  // generate token",
    "highlights": [
      { "line": 60, "type": "branched", "annotation": "Condition: isValid === true" }
    ]
  },
  "narrative": "The password hash is compared. In this scenario, credentials are valid so we take the 'if' branch.",
  "state": {
    "scopes": [
      {
        "name": "local",
        "variables": {
          "isValid": {
            "value": "true",
            "type": "boolean",
            "changed": true,
            "action": "created",
            "source": { "tool": "ai:claude", "timestamp": "2026-04-05T00:00:00Z", "confidence": 0.88 }
          }
        }
      }
    ],
    "changes": ["isValid: undefined → true"]
  },
  "stackDepth": 1,
  "parentCellId": "cell-0",
  "callStack": [
    { "functionName": "AuthService.authenticateUser", "filePath": "src/auth/login.ts", "line": 18, "depth": 0, "cellId": "cell-0" },
    { "functionName": "AuthService.validateCredentials", "filePath": "src/auth/login.ts", "line": 60, "depth": 1 }
  ],
  "source": { "tool": "ai:claude", "timestamp": "2026-04-05T00:00:00Z", "confidence": 0.88 },
  "confidence": 0.88,
  "status": "complete"
}
```

## Important Notes

- **Do NOT require static analyzers.** Read the code directly with AI understanding. Static analyzers (clangd, IntelliSense) can be used for faster evaluation but are never mandatory.
- **Every cell must have `code.text`** — include the actual source code, not just line references.
- **Use `highlights` generously** — they drive the VS Code editor highlighting.
- **Track `parentCellId`** — this builds the call hierarchy without nested JSON.
- **Set `status` appropriately** — use 'skeleton' if only code is filled, 'partial' if narrative is added, 'complete' if state is also filled.
- **Imagine realistic variable values** — use scenario context to choose plausible values.
- **Add `steps` to dense cells** — any cell with 3+ lines of distinct logic should have sub-steps. Each step focuses on one line/concept. The viewer shows one step at a time for clarity.
- **Create branch points for conditionals** — when there's an `if`/`switch` with meaningfully different paths, use `nextCellIds` with multiple entries and `branchOptions` so the user can explore all branches. Create cells for ALL paths, not just one.
- **Mark terminal cells** — cells at the end of a branch path should have `nextCellIds: []`.
