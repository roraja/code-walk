/**
 * Code Walk in Cells — Data structures (Idea 4 from design doc).
 *
 * A code walk is a Jupyter-notebook-style ordered sequence of **cells**,
 * where each cell represents a meaningful chunk of execution. Cells are
 * the unit of authoring, correction, display, and navigation.
 *
 * Key properties:
 * - Flat array with parent references (easy to serialize, paginate)
 * - Each cell carries its own status (skeleton / partial / complete / corrected)
 * - Code slices with line highlights make the walk visually browsable
 * - Variables track `changed` flag per cell for instant diff rendering
 * - `stackDepth` + `parentCellId` reconstruct call hierarchy without nesting
 * - AI doesn't *require* static analyzers but can leverage them for speed
 *
 * @module codewalk-types
 */

// ---------------------------------------------------------------------------
// Core walk structure
// ---------------------------------------------------------------------------

/** A complete code walk — the top-level container. */
export interface CodeWalk {
  id: string;
  name: string;
  description: string;
  /** The scenario this walk was generated from (if any) */
  scenarioId?: string;
  cells: WalkCell[];
  meta: WalkMeta;
}

/** Metadata about the walk itself. */
export interface WalkMeta {
  /** Tools/agents that contributed to this walk */
  contributors: WalkContributor[];
  createdAt: string;
  updatedAt: string;
  /** User-defined tags for filtering/categorization */
  tags: string[];
  /** Entry point of the walk (first cell's location) */
  entryPoint?: CodeLocation;
}

/** A contributor that helped populate this walk. */
export interface WalkContributor {
  /** Tool or agent name: 'clangd', 'ai:claude', 'human:roraja', etc. */
  tool: string;
  /** Which fields this tool populated */
  fieldsPopulated: string[];
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Walk Cell — the fundamental unit
// ---------------------------------------------------------------------------

/** A cell is a chunk of execution — the atomic unit of the walk. */
export interface WalkCell {
  id: string;
  /** Sequential position in the walk (0-based) */
  index: number;
  /** What kind of execution chunk this cell represents */
  type: CellType;

  /** The code being discussed in this cell */
  code: CodeSlice;

  /** Human-readable explanation (AI or human authored) */
  narrative?: string;

  /** Variable state at the END of this cell */
  state?: CellState;

  /** How deep in the call stack this cell is */
  stackDepth: number;
  /** Which 'call' or 'entry' cell spawned this context */
  parentCellId?: string;

  /** The full call stack at this cell (derived from parentCellId chain or explicitly set) */
  callStack?: CellCallStackFrame[];

  /** Provenance: who/what produced this cell */
  source: DataSource;
  /** AI confidence in this cell's accuracy (0.0 - 1.0) */
  confidence?: number;
  /** How complete this cell is */
  status: CellStatus;

  /** Corrections applied to this cell */
  corrections?: CellCorrection[];

  /** Podcast-style dialogue segments with highlight cues for video generation */
  podcast?: PodcastSegment[];

  /**
   * Sub-steps within this cell — sequential focus points that guide the
   * viewer through the cell's code one concept at a time. When present,
   * the viewer shows one step at a time instead of the full narrative,
   * highlighting the focused line strongly while the overall cell range
   * gets a lighter background.
   */
  steps?: CellStep[];

  /**
   * IDs of cells that can follow this one. Enables tree-structured walks:
   * - Omitted or empty: the next cell is determined by linear order (index + 1)
   * - Single entry: deterministic next cell (explicit link)
   * - Multiple entries: a **branch point** — the viewer asks the user to choose
   *
   * Each entry corresponds to a `BranchOption` in `branchOptions` (same order).
   * If `branchOptions` is absent, the viewer shows cell IDs as labels.
   */
  nextCellIds?: string[];

  /**
   * Describes each branch option when `nextCellIds` has multiple entries.
   * The array order matches `nextCellIds`. Each option provides a human-readable
   * label, a short description, and optional context (condition, variable values)
   * so the user can decide which execution path to explore.
   */
  branchOptions?: BranchOption[];
}

/** A sub-step within a cell — focuses on a single line/concept. */
export interface CellStep {
  /** Short description of what this line/concept does */
  description: string;
  /** The specific line number to strongly highlight (1-based, absolute in file) */
  focusLine: number;
  /** Optional end line for a multi-line focus range (1-based, inclusive) */
  focusEndLine?: number;
}

/**
 * A branch option describing one possible execution path from a branch cell.
 * Used when a cell's `nextCellIds` has multiple entries — each option gives
 * the user enough context to decide which path to explore.
 */
export interface BranchOption {
  /** Short label for the option (shown as button/menu text), e.g. "true — supported type" */
  label: string;
  /** Longer description of what happens on this path */
  description: string;
  /** The condition expression or value that leads to this path (e.g. "mimeType === 'image/jpeg'") */
  condition?: string;
  /** Visual indicator: 'taken' (this is the expected/common path), 'skipped', or 'error' */
  pathHint?: 'taken' | 'skipped' | 'error' | 'default';
}

/** A single dialogue segment in a podcast-style narration. */
export interface PodcastSegment {
  /** Speaker name (e.g., 'Sarah', 'Michael') */
  speaker: string;
  /** The dialogue text to be spoken */
  text: string;
  /** Line number to spotlight during this segment (null = no change / keep previous) */
  spotlight?: number | null;
  /** Range of lines to spotlight [start, end] (alternative to single line) */
  spotlightRange?: [number, number];
}

/** Cell types — what kind of execution chunk */
export type CellType =
  | 'entry'          // entering a function (function signature + initial state)
  | 'call'           // calling another function (the call site)
  | 'branch'         // evaluating a condition (if/switch/ternary)
  | 'assignment'     // variable assignment(s)
  | 'return'         // returning from a function
  | 'dispatch'       // virtual dispatch / interface resolution
  | 'block'          // a block of sequential statements (grouped for brevity)
  | 'note';          // pure commentary cell (no code)

/** How complete this cell is — supports incremental population. */
export type CellStatus = 'skeleton' | 'partial' | 'complete' | 'corrected';

// ---------------------------------------------------------------------------
// Code Slice — the code a cell refers to
// ---------------------------------------------------------------------------

/** A slice of source code that a cell discusses. */
export interface CodeSlice {
  /** Absolute or workspace-relative file path */
  filePath: string;
  /** First line of the slice (1-based) */
  startLine: number;
  /** Last line of the slice (1-based, inclusive) */
  endLine: number;
  /** The actual source code text */
  text: string;
  /** Specific lines to visually emphasize within the slice */
  highlights?: LineHighlight[];
}

/** A highlighted line within a code slice. */
export interface LineHighlight {
  /** Line number (1-based, absolute in the file) */
  line: number;
  /** Why this line is highlighted */
  type: 'executed' | 'skipped' | 'branched' | 'assigned' | 'called' | 'returned';
  /** Optional short annotation shown next to the line */
  annotation?: string;
}

// ---------------------------------------------------------------------------
// Cell State — variables at the end of a cell
// ---------------------------------------------------------------------------

/** Variable state at the end of a cell, organized by scope. */
export interface CellState {
  /** Variables organized by scope (local, parameters, this, closure, etc.) */
  scopes: CellScope[];

  /** Quick summary of what changed in this cell */
  changes?: string[];    // e.g. ["x: 5 → 10", "user: null → {id: 123}"]
}

/** A group of variables in a specific scope. */
export interface CellScope {
  /** Scope name: 'local', 'parameters', 'this', 'closure', 'global', etc. */
  name: string;
  /** Variables in this scope */
  variables: Record<string, CellVariable>;
}

/** A single variable's value within a cell. */
export interface CellVariable {
  /** Display value (string representation) */
  value: string;
  /** Declared or inferred type */
  type?: string;
  /** Did this variable change in this cell? (for highlight rendering) */
  changed: boolean;
  /** How was this value determined */
  action?: 'created' | 'modified' | 'read' | 'unchanged';
  /** Who provided this value */
  source: DataSource;
  /** AI explanation of why this value was chosen */
  rationale?: string;
}

// ---------------------------------------------------------------------------
// Call Stack
// ---------------------------------------------------------------------------

/** A frame in the call stack at a given cell. */
export interface CellCallStackFrame {
  /** Function name (qualified) */
  functionName: string;
  /** File location */
  filePath: string;
  /** Line number in the file */
  line: number;
  /** Depth in the stack (0 = root) */
  depth: number;
  /** The cell ID that represents this function's entry */
  cellId?: string;
}

// ---------------------------------------------------------------------------
// Provenance
// ---------------------------------------------------------------------------

/** Who/what produced a piece of data. */
export interface DataSource {
  /** Tool identifier: 'clangd', 'intellisense', 'ai:claude', 'ai:gpt-4', 'human', etc. */
  tool: string;
  /** Specific agent/person name */
  agent?: string;
  /** When this data was produced */
  timestamp: string;
  /** Confidence in this data (0.0 - 1.0) */
  confidence: number;
}

// ---------------------------------------------------------------------------
// Code Location (reusable)
// ---------------------------------------------------------------------------

/** A specific location in source code. */
export interface CodeLocation {
  filePath: string;
  line: number;
  column?: number;
  functionName?: string;
}

// ---------------------------------------------------------------------------
// Corrections
// ---------------------------------------------------------------------------

/** A correction applied to a cell. */
export interface CellCorrection {
  /** Which field was corrected (e.g., 'narrative', 'state.scopes[0].variables.x') */
  field: string;
  oldValue: unknown;
  newValue: unknown;
  /** Who made the correction */
  author: string;
  timestamp: string;
  /** Why the correction was made */
  reason?: string;
}

// ---------------------------------------------------------------------------
// File format — on-disk representation
// ---------------------------------------------------------------------------

/**
 * V1: Single-file format — everything in one `.codewalk.json`.
 * Backward compatible, still fully supported for reading and writing.
 */
export interface CodeWalkFileData {
  _format: 'codegraph-codewalk-v1';
  walk: CodeWalk;
}

/**
 * V2: Multi-file format — walk manifest + individual cell files.
 *
 * Storage layout:
 * ```
 * .vscode/code-graph/codewalks/<walk-id>/
 *   manifest.codewalk.json   ← CodeWalkManifest (walk metadata, no cells)
 *   cell-0.json              ← individual WalkCell
 *   cell-1.json              ← individual WalkCell
 *   ...
 * ```
 *
 * The manifest contains everything from CodeWalk except the `cells` array,
 * which is replaced by `cellIds` — the ordered list of cell file basenames.
 * Each cell file contains a single `CodeWalkCellFileData`.
 */
export interface CodeWalkManifest {
  _format: 'codegraph-codewalk-v2';
  walk: {
    id: string;
    name: string;
    description: string;
    scenarioId?: string;
    /** Ordered list of cell IDs (file basenames without .json) */
    cellIds: string[];
    meta: WalkMeta;
  };
}

/** The shape of a single cell file on disk (v2 multi-file format). */
export interface CodeWalkCellFileData {
  _format: 'codegraph-cell-v1';
  walkId: string;
  cell: WalkCell;
}
