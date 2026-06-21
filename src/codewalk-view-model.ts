/**
 * Serializable view model passed from the extension (Node) to the React webview.
 *
 * The webview is intentionally **presentation only** — all navigation logic
 * (history stack, branch resolution, step indices) lives in the extension's
 * {@link CodeWalkCellsViewProvider}. On every state change the provider builds a
 * fresh {@link WalkViewModel} and posts it to the webview, which simply renders
 * it.
 *
 * Note: the model deliberately omits raw source code. The sidebar shows the
 * *explanation* of each step in clear prose; the actual code is highlighted in
 * the editor instead.
 *
 * @module codewalk-view-model
 */

import type { CellType, CellStatus } from './codewalk-types.js';

/** A single variable shown in the (optional) state section. */
export interface VarVM {
  name: string;
  value: string;
  type?: string;
  changed: boolean;
  action?: 'created' | 'modified' | 'read' | 'unchanged';
  rationale?: string;
}

/** A scope grouping of variables. */
export interface ScopeVM {
  name: string;
  vars: VarVM[];
}

/** A single call-stack frame. */
export interface StackFrameVM {
  depth: number;
  functionName: string;
  filePath: string;
  line: number;
  fileName: string;
  isTop: boolean;
}

/** A branch option the user can choose from. */
export interface BranchOptionVM {
  index: number;
  label: string;
  description: string;
  condition?: string;
  hint: 'taken' | 'skipped' | 'error' | 'default';
}

/** A single entry in the cell mini-list. */
export interface CellListItemVM {
  index: number;
  label: string;
  type: CellType;
  status: CellStatus;
  stackDepth: number;
  isActive: boolean;
  isVisited: boolean;
  hasBranch: boolean;
}

/** The currently focused cell, reduced to display-ready fields (no code text). */
export interface CellVM {
  type: CellType;
  typeLabel: string;
  status: CellStatus;
  confidencePct?: string;
  confidenceLevel?: 'high' | 'mid' | 'low';
  stackDepth: number;

  /** Primary explanation prose for the cell. */
  narrative?: string;

  /** Where this step lives in source — used only to jump to the editor. */
  filePath: string;
  fileLabel: string;
  startLine: number;
  endLine: number;

  /** Sub-step walkthrough (explanation focused). */
  hasSteps: boolean;
  stepIndex: number;
  stepsTotal: number;
  stepDescription?: string;

  hasBranching: boolean;
  branchOptions: BranchOptionVM[];

  scopes: ScopeVM[];
  changes: string[];

  callStack: StackFrameVM[];
}

/** The complete state the webview needs to render one frame. */
export interface WalkViewModel {
  walk: { name: string; description: string } | null;
  cell: CellVM | null;
  activeIndex: number;
  totalCells: number;
  progressPct: number;
  canGoBack: boolean;
  isEndCell: boolean;
  breadcrumb: string[];
  cells: CellListItemVM[];
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

/** Messages the extension posts to the webview. */
export type ExtensionToWebviewMessage = { type: 'render'; model: WalkViewModel };

/** Messages the webview posts back to the extension. */
export type WebviewToExtensionMessage =
  | { type: 'ready' }
  | { type: 'nextCell' }
  | { type: 'prevCell' }
  | { type: 'nextStep' }
  | { type: 'prevStep' }
  | { type: 'goToStep'; stepIndex: number }
  | { type: 'navigateToCell'; index: number }
  | { type: 'selectBranch'; branchIndex: number }
  | { type: 'openWalk' }
  | { type: 'openFrame'; filePath: string; line: number; functionName: string };
