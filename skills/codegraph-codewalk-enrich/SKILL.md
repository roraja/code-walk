---
name: codewalk-enrich
description: "Use this skill when the user asks to 'enrich a code walk', 'add variables to code walk',
  'add explanations to code walk', 'fill in code walk cells', 'upgrade skeleton cells',
  'codewalk enrich', 'improve code walk quality', or when they want to add narrative, variable state,
  and call stacks to existing skeleton/partial cells in a .codewalk.json file."
---

# Code Walk Enrich — Upgrade Existing Cells

Enrich existing code walk cells that are in 'skeleton' or 'partial' status by adding AI explanations, imagined variable values, call stacks, and line highlights.

## When to Use

- User has an existing code walk (v1 single-file `.codewalk.json` or v2 multi-file directory) with skeleton/partial cells
- User wants to add narrative, variables, or call stacks to existing cells
- User wants to upgrade cell status from skeleton → partial → complete

## Data Structure Reference

See the `codewalk-populate` skill for the full data structure specification. This skill operates on existing cells within an already-created code walk (either format).

## Procedure

### Step 1: Read the Existing Code Walk

Look for the walk in `.vscode/code-graph/codewalks/`. It may be stored as:
- **V2 (directory):** `.vscode/code-graph/codewalks/<walk-id>/manifest.codewalk.json` + individual `<cell-id>.json` files
- **V1 (single file):** `.vscode/code-graph/codewalks/<walk-id>.codewalk.json`

For v2, read the manifest to see the cell list, then read individual cell files as needed.

### Step 2: Identify Cells to Enrich

Find cells with status `skeleton` or `partial`:
- **skeleton** → needs: narrative, state, callStack, highlights
- **partial** → may need: state (variable values), callStack, better highlights

### Step 3: Read Referenced Source Code

For each cell to enrich, read the actual source file at the referenced path and lines. Understand the context of what the code does.

### Step 4: Add Missing Fields

For each cell being enriched:

#### Narrative (if missing)
Write a clear explanation of:
- What this code does
- WHY it does it (context in the scenario)
- Any important design decisions or edge cases

#### State / Variables (if missing)
Imagine realistic variable values based on the scenario:

```json
{
  "scopes": [
    {
      "name": "local",
      "variables": {
        "result": {
          "value": "{ success: true, userId: 123 }",
          "type": "AuthResult",
          "changed": true,
          "action": "created",
          "source": { "tool": "ai:claude", "timestamp": "...", "confidence": 0.88 },
          "rationale": "Authentication succeeds in the happy path scenario"
        }
      }
    }
  ],
  "changes": ["result: undefined → { success: true, userId: 123 }"]
}
```

For each variable, set:
- `changed: true` if the variable was created or modified in this cell
- `action`: 'created' (new), 'modified' (changed value), 'read' (used but not changed), 'unchanged' (carried from previous cell)
- `source.tool`: "ai:claude"
- `rationale`: Why you chose this value

#### Call Stack (if missing)
Build from the cell's `parentCellId` chain:
```json
[
  { "functionName": "main", "filePath": "src/main.ts", "line": 10, "depth": 0, "cellId": "cell-0" },
  { "functionName": "processRequest", "filePath": "src/handler.ts", "line": 42, "depth": 1, "cellId": "cell-2" }
]
```

#### Highlights (if missing or sparse)
Add line highlights for important lines:
```json
[
  { "line": 45, "type": "executed", "annotation": "Entry point of the handler" },
  { "line": 52, "type": "branched", "annotation": "Check: is user authenticated?" },
  { "line": 55, "type": "assigned", "annotation": "Store the validated token" }
]
```

### Step 5: Update Cell Status

- skeleton → partial (if narrative added but not variables)
- skeleton → complete (if narrative + variables + callStack added)
- partial → complete (if remaining fields filled)

### Step 6: Update Metadata

Add/update the contributor entry in `walk.meta.contributors`:
```json
{
  "tool": "ai:claude",
  "fieldsPopulated": ["narrative", "state", "callStack", "highlights"],
  "timestamp": "<ISO-8601>"
}
```

Update `walk.meta.updatedAt`.

### Step 7: Save

**V2 (multi-file):** Write each updated cell back to its individual `<cell-id>.json` file. Update the manifest only if metadata changed.

**V1 (single-file):** Write the updated JSON back to the same `.codewalk.json` file.

## Important Notes

- **Preserve existing data** — only add missing fields, never overwrite existing narratives or variables unless explicitly asked
- **Match the scenario context** — variable values should be consistent across cells (if email is "user@example.com" in cell 0, it should be the same in cell 3)
- **Track provenance** — every value you add should have `source.tool: "ai:claude"` and a reasonable confidence
- **Static analyzers are optional** — read code directly, but leverage clangd/IntelliSense if available for type information
- **Add sub-steps to dense cells** — if a cell has 3+ conceptually distinct lines, add a `steps` array. Each step has `description` (what this line does) and `focusLine` (1-based line number to highlight). The viewer shows one step at a time for clarity. See the `codewalk-populate` skill for the `CellStep` structure.
- **Add branching to conditional cells** — when enriching a `branch` cell that evaluates a condition (if/switch/ternary), consider adding `nextCellIds` and `branchOptions` to let users explore multiple execution paths. See the "Branching" section below.

## Branching Support

When enriching branch cells, you can convert a linear walk into a tree-structured walk by adding branching:

### When to Add Branching

- A `branch` cell evaluates a condition but only shows ONE path
- The user asks to "add the other branch" or "show what happens if..."
- The code has meaningful alternative paths worth exploring

### How to Add Branching

1. **On the branch cell**: Set `nextCellIds` to an array of cell IDs for each path. Add `branchOptions` with labels and descriptions.
2. **Create cells for the new path**: Add new cell files for the alternative execution path (e.g., `cell-6.json`, `cell-7.json`).
3. **Mark terminal cells**: Cells at the end of each path should have `nextCellIds: []`.
4. **Update the manifest**: Add the new cell IDs to the manifest's `cellIds` array.

### BranchOption Structure

```typescript
interface BranchOption {
  label: string;           // Short label, e.g. "true — valid credentials"
  description: string;     // What happens on this path
  condition?: string;      // The condition, e.g. "isValid === true"
  pathHint?: 'taken' | 'skipped' | 'error' | 'default';  // Visual hint
}
```

### nextCellIds Semantics

| Value | Meaning |
|-------|---------|
| Omitted | Linear navigation (next by index) |
| `[]` | End cell — no further navigation |
| `["cell-5"]` | Explicit next cell |
| `["cell-4", "cell-6"]` | Branch point — user chooses |
