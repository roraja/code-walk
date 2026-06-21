/**
 * Mock data + an in-browser controller for the UI dev server.
 *
 * The controller mirrors the navigation behaviour of the real
 * {@link CodeWalkCellsViewProvider} (history stack, sub-steps, branch
 * resolution) and produces the same {@link WalkViewModel} the React app
 * consumes — so the dev harness exercises the exact production UI, just driven
 * by fake data instead of the VS Code extension host.
 *
 * @module dev/mock-data
 */

import type {
  WalkViewModel,
  CellVM,
  CellListItemVM,
  WebviewToExtensionMessage,
} from '../../codewalk-view-model.js';

/** A simplified authored cell used only by the dev harness. */
interface MockCell {
  id: string;
  type: CellVM['type'];
  status: CellVM['status'];
  stackDepth: number;
  confidence?: number;
  label: string;
  narrative: string;
  filePath: string;
  startLine: number;
  endLine: number;
  steps?: string[];
  scopes?: CellVM['scopes'];
  changes?: string[];
  callStack?: CellVM['callStack'];
  nextCellIds?: string[];
  branchOptions?: CellVM['branchOptions'];
}

const WALK = {
  name: 'Image upload → thumbnail pipeline',
  description: 'How an uploaded image flows from the request handler to thumbnail generation.',
};

const CELLS: MockCell[] = [
  {
    id: 'c0',
    type: 'entry',
    status: 'complete',
    stackDepth: 0,
    confidence: 0.96,
    label: 'handleUpload',
    narrative:
      'A POST request hits handleUpload(). The handler receives the multipart request and pulls the first file off the form data. Nothing has been validated yet — that happens next.',
    filePath: 'src/server/routes/upload.ts',
    startLine: 42,
    endLine: 58,
    scopes: [
      {
        name: 'parameters',
        vars: [{ name: 'req', value: 'IncomingMessage', type: 'Request', changed: true, action: 'created' }],
      },
    ],
    callStack: [
      { depth: 0, functionName: 'handleUpload', filePath: 'src/server/routes/upload.ts', line: 42, fileName: 'upload.ts', isTop: true },
    ],
  },
  {
    id: 'c1',
    type: 'call',
    status: 'complete',
    stackDepth: 1,
    confidence: 0.88,
    label: '→ validateImage',
    narrative:
      'handleUpload calls validateImage(file) to make sure the upload is a real, supported image before doing any expensive work.',
    filePath: 'src/server/images/validate.ts',
    startLine: 11,
    endLine: 33,
    steps: [
      'First we read the MIME type reported by the browser from the upload headers.',
      'Then we sniff the first few bytes (the magic number) to confirm the MIME type is not spoofed.',
      'Finally we compare the detected type against the allow-list of supported formats.',
    ],
    scopes: [
      {
        name: 'local',
        vars: [
          { name: 'mimeType', value: "'image/jpeg'", type: 'string', changed: true, action: 'created' },
          { name: 'sizeBytes', value: '184320', type: 'number', changed: true, action: 'created', rationale: 'From the Content-Length of the file part.' },
        ],
      },
    ],
    changes: ['mimeType: undefined → "image/jpeg"', 'sizeBytes: 0 → 184320'],
    callStack: [
      { depth: 0, functionName: 'handleUpload', filePath: 'src/server/routes/upload.ts', line: 49, fileName: 'upload.ts', isTop: false },
      { depth: 1, functionName: 'validateImage', filePath: 'src/server/images/validate.ts', line: 11, fileName: 'validate.ts', isTop: true },
    ],
  },
  {
    id: 'c2',
    type: 'branch',
    status: 'complete',
    stackDepth: 1,
    confidence: 0.72,
    label: 'Branch',
    narrative:
      'validateImage decides what to do based on whether the detected MIME type is in the supported set. This is a fork — choose a path to explore.',
    filePath: 'src/server/images/validate.ts',
    startLine: 34,
    endLine: 40,
    callStack: [
      { depth: 0, functionName: 'handleUpload', filePath: 'src/server/routes/upload.ts', line: 49, fileName: 'upload.ts', isTop: false },
      { depth: 1, functionName: 'validateImage', filePath: 'src/server/images/validate.ts', line: 34, fileName: 'validate.ts', isTop: true },
    ],
    nextCellIds: ['c3', 'c4'],
    branchOptions: [
      { index: 0, label: 'Supported type', description: 'The MIME type is in the allow-list, so processing continues.', condition: 'SUPPORTED.has(mimeType)', hint: 'taken' },
      { index: 1, label: 'Unsupported type', description: 'The type is rejected and a 415 is returned to the client.', condition: '!SUPPORTED.has(mimeType)', hint: 'error' },
    ],
  },
  {
    id: 'c3',
    type: 'call',
    status: 'complete',
    stackDepth: 1,
    confidence: 0.84,
    label: '→ makeThumbnail',
    narrative:
      'On the supported-type path, the image is handed to makeThumbnail(), which resizes it to a 256px-wide preview and writes it to the cache directory.',
    filePath: 'src/server/images/thumbnail.ts',
    startLine: 20,
    endLine: 48,
    steps: [
      'Decode the original image buffer into a pixel bitmap.',
      'Scale it down preserving aspect ratio to a 256px width.',
      'Encode the result as WebP and write it to disk.',
    ],
    scopes: [
      {
        name: 'local',
        vars: [
          { name: 'width', value: '256', type: 'number', changed: true, action: 'created' },
          { name: 'outPath', value: "'/cache/thumb_8f2.webp'", type: 'string', changed: true, action: 'created' },
        ],
      },
    ],
    changes: ['width: → 256', 'outPath: → "/cache/thumb_8f2.webp"'],
    callStack: [
      { depth: 0, functionName: 'handleUpload', filePath: 'src/server/routes/upload.ts', line: 51, fileName: 'upload.ts', isTop: false },
      { depth: 1, functionName: 'makeThumbnail', filePath: 'src/server/images/thumbnail.ts', line: 20, fileName: 'thumbnail.ts', isTop: true },
    ],
    nextCellIds: ['c5'],
  },
  {
    id: 'c4',
    type: 'return',
    status: 'complete',
    stackDepth: 1,
    confidence: 0.9,
    label: '← 415 response',
    narrative:
      'On the unsupported-type path, validateImage throws an UnsupportedMediaError. The handler catches it and responds with HTTP 415. This is a terminal step for this branch.',
    filePath: 'src/server/images/validate.ts',
    startLine: 38,
    endLine: 39,
    callStack: [
      { depth: 0, functionName: 'handleUpload', filePath: 'src/server/routes/upload.ts', line: 55, fileName: 'upload.ts', isTop: false },
      { depth: 1, functionName: 'validateImage', filePath: 'src/server/images/validate.ts', line: 38, fileName: 'validate.ts', isTop: true },
    ],
    nextCellIds: [],
  },
  {
    id: 'c5',
    type: 'return',
    status: 'corrected',
    stackDepth: 0,
    confidence: 0.93,
    label: '← 201 response',
    narrative:
      'Back in handleUpload, the thumbnail path is attached to the response body and a 201 Created is sent. The walk ends here.',
    filePath: 'src/server/routes/upload.ts',
    startLine: 52,
    endLine: 58,
    scopes: [
      {
        name: 'local',
        vars: [{ name: 'status', value: '201', type: 'number', changed: true, action: 'modified' }],
      },
    ],
    changes: ['status: 200 → 201'],
    callStack: [
      { depth: 0, functionName: 'handleUpload', filePath: 'src/server/routes/upload.ts', line: 52, fileName: 'upload.ts', isTop: true },
    ],
    nextCellIds: [],
  },
];

const ID_TO_INDEX = new Map(CELLS.map((c, i) => [c.id, i]));

/**
 * Drives the dev UI: holds navigation state and posts `render` messages back to
 * the webview (the React app) exactly like the extension host would.
 */
export class MockController {
  private index = 0;
  private stepIndex = -1;
  private history: number[] = [];

  constructor(private readonly emit: (model: WalkViewModel) => void) {
    this.resetStep();
  }

  handle(message: WebviewToExtensionMessage): void {
    switch (message.type) {
      case 'ready':
        break;
      case 'nextCell':
        this.next();
        break;
      case 'prevCell':
        this.prev();
        break;
      case 'nextStep':
        this.stepBy(1);
        break;
      case 'prevStep':
        this.stepBy(-1);
        break;
      case 'goToStep':
        this.goToStep(message.stepIndex);
        break;
      case 'navigateToCell':
        this.goToCell(message.index);
        break;
      case 'selectBranch':
        this.selectBranch(message.branchIndex);
        break;
      case 'openFrame':
        console.info('[dev] openFrame', message.filePath, message.line);
        break;
      case 'openWalk':
        console.info('[dev] openWalk');
        break;
    }
    this.render();
  }

  render(): void {
    this.emit(this.buildModel());
  }

  private resetStep(): void {
    const cell = CELLS[this.index];
    this.stepIndex = cell.steps && cell.steps.length > 0 ? 0 : -1;
  }

  private next(): void {
    const cell = CELLS[this.index];
    if (cell.steps && this.stepIndex < cell.steps.length - 1) {
      this.stepIndex++;
      return;
    }
    if (cell.nextCellIds && cell.nextCellIds.length > 1) return; // branch — wait for choice
    if (cell.nextCellIds && cell.nextCellIds.length === 1) {
      this.forward(ID_TO_INDEX.get(cell.nextCellIds[0])!);
      return;
    }
    if (this.index < CELLS.length - 1) this.forward(this.index + 1);
  }

  private prev(): void {
    const cell = CELLS[this.index];
    if (cell.steps && this.stepIndex > 0) {
      this.stepIndex--;
      return;
    }
    if (this.history.length > 0) {
      this.index = this.history.pop()!;
      this.resetStep();
    }
  }

  private stepBy(delta: number): void {
    const cell = CELLS[this.index];
    if (!cell.steps) return;
    const next = this.stepIndex + delta;
    if (next >= 0 && next < cell.steps.length) this.stepIndex = next;
  }

  private goToStep(stepIndex: number): void {
    const cell = CELLS[this.index];
    if (cell.steps && stepIndex >= 0 && stepIndex < cell.steps.length) this.stepIndex = stepIndex;
  }

  private goToCell(index: number): void {
    if (index >= 0 && index < CELLS.length && index !== this.index) {
      this.history.push(this.index);
      this.index = index;
      this.resetStep();
    }
  }

  private selectBranch(branchIndex: number): void {
    const cell = CELLS[this.index];
    const targetId = cell.nextCellIds?.[branchIndex];
    if (targetId && ID_TO_INDEX.has(targetId)) this.forward(ID_TO_INDEX.get(targetId)!);
  }

  private forward(target: number): void {
    this.history.push(this.index);
    this.index = target;
    this.resetStep();
  }

  private buildModel(): WalkViewModel {
    const cell = CELLS[this.index];
    const hasSteps = !!(cell.steps && cell.steps.length > 0 && this.stepIndex >= 0);
    const hasBranching = !!(cell.nextCellIds && cell.nextCellIds.length > 1);
    const isEndCell = cell.nextCellIds ? cell.nextCellIds.length === 0 : this.index >= CELLS.length - 1;

    let confidencePct: string | undefined;
    let confidenceLevel: CellVM['confidenceLevel'];
    if (cell.confidence !== undefined) {
      confidencePct = `${(cell.confidence * 100).toFixed(0)}%`;
      confidenceLevel = cell.confidence >= 0.8 ? 'high' : cell.confidence >= 0.5 ? 'mid' : 'low';
    }

    const cellVM: CellVM = {
      type: cell.type,
      typeLabel: cell.type.charAt(0).toUpperCase() + cell.type.slice(1),
      status: cell.status,
      confidencePct,
      confidenceLevel,
      stackDepth: cell.stackDepth,
      narrative: cell.narrative,
      filePath: cell.filePath,
      fileLabel: cell.filePath.split('/').slice(-3).join('/'),
      startLine: cell.startLine,
      endLine: cell.endLine,
      hasSteps,
      stepIndex: hasSteps ? this.stepIndex : 0,
      stepsTotal: cell.steps?.length ?? 0,
      stepDescription: hasSteps ? cell.steps![this.stepIndex] : undefined,
      hasBranching,
      branchOptions: hasBranching ? cell.branchOptions ?? [] : [],
      scopes: cell.scopes ?? [],
      changes: cell.changes ?? [],
      callStack: cell.callStack ?? [],
    };

    const list: CellListItemVM[] = CELLS.map((c, i) => ({
      index: i,
      label: c.label,
      type: c.type,
      status: c.status,
      stackDepth: c.stackDepth,
      isActive: i === this.index,
      isVisited: this.history.includes(i),
      hasBranch: !!(c.nextCellIds && c.nextCellIds.length > 1),
    }));

    const breadcrumb =
      this.history.length > 0
        ? [...this.history.slice(-5), this.index].map((i) => CELLS[i].label)
        : [];

    return {
      walk: WALK,
      cell: cellVM,
      activeIndex: this.index,
      totalCells: CELLS.length,
      progressPct: Math.round(((this.index + 1) / CELLS.length) * 100),
      canGoBack: this.history.length > 0,
      isEndCell,
      breadcrumb,
      cells: list,
    };
  }
}
