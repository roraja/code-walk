---
name: codegraph-code-walk
description: "Use this skill when the user asks to 'walk through code', 'code walkthrough',
  'step through scenario', 'explain execution', 'codegraph walk', 'show me the code path',
  'walkthrough', or when they want an interactive step-by-step walkthrough of a traced
  scenario showing source code, variable state, AI justifications, and call stacks
  at each step. Also covers justification generation for tracing decisions."
---

# CodeGraph Code Walk Skill

Provide interactive, step-by-step walkthroughs of traced scenarios, showing
source code, variable state, AI justifications, call stacks, and confidence
levels at each step. Also generate human-readable justifications for branch
and dispatch decisions.

## When to Use

Use when the user says:
- "walk through scenario", "code walkthrough"
- "step through the trace", "show me the code path"
- "codegraph walk `<scenario-id>`"
- "explain this execution step"
- "why was this branch taken", "justify this decision"
- "show variables at step N"
- "what happens at step N"

## Domain Context

After a scenario has been traced (see codegraph-scenario-tracing skill), users
review the execution path interactively. The walkthrough presents each step with
contextual information and allows users to submit corrections (see
codegraph-correction-interpreter skill).

## Scenario & Step Data Model

### Scenario
```typescript
{
  id: "user-login-flow",
  name: "User Login Flow",
  description: "End-to-end user authentication...",
  discoveredBy: "ai" | "human",
  confidence: 0.92,
  status: "draft" | "traced" | "validated" | "corrected",
  entryFunction: "AuthService.authenticateUser",
  triggerCondition: "User submits login form",
  version: 2,
  createdAt: "2024-01-15T10:30:00Z",
  updatedAt: "2024-01-16T14:00:00Z"
}
```

### ScenarioStep
```typescript
{
  id: "step-1",
  scenarioId: "user-login-flow",
  stepNumber: 1,
  functionId: "src/auth/login.ts:15",
  functionName: "AuthService.authenticateUser",
  line: 18,
  action: "call" | "branch_taken" | "branch_skipped" | "dispatch" | "return" | "assign",
  justification: "Entry point: authenticateUser is called when user submits login form.",
  variableState: { email: "\"user@example.com\"", password: "\"***\"" },
  sourceCode: "const user = await this.userRepo.findByEmail(email);",
  confidence: 0.95,
  correctedBy: null,        // set if user corrected this step
  correctionNote: null,     // the correction message
  callStack: [
    {
      depth: 0,
      functionId: "src/auth/login.ts:15",
      functionName: "AuthService.authenticateUser",
      filePath: "src/auth/login.ts",
      line: 18,
      variables: {
        email: { value: "\"user@example.com\"", type: "string", rationale: "...", alternatives: [...], confidence: 0.9 },
        password: { value: "\"***\"", type: "string", rationale: "...", alternatives: [...], confidence: 0.95 }
      }
    }
  ]
}
```

## Step Action Types

| Action | Color | Meaning |
|--------|-------|---------|
| `call` | Blue | Entering a function |
| `branch_taken` | Green | Condition was true, took the "then" path |
| `branch_skipped` | Red | Condition was false, took the "else" path |
| `dispatch` | Magenta | Virtual dispatch resolved to a concrete implementation |
| `return` | Yellow | Returning from a function |
| `assign` | Cyan | Variable assignment |

## Walkthrough Presentation

### Step Display Format
For each step, present:

1. **Step header**: `Step N/total — ACTION [functionName:line]`
2. **Source code**: The line being executed
3. **Justification**: Brief (truncated to ~100 chars in summary, full on demand)
4. **Confidence bar**: Visual `0-100%` with color coding
   - >= 80%: Green (high confidence)
   - >= 50%: Yellow (moderate, worth reviewing)
   - < 50%: Red (low confidence, likely needs correction)
5. **Correction indicator**: If this step was corrected by a user

### Variable State Display
On demand, show all tracked variables at the current step:
```
  email = "user@example.com"
  isValid = true
  tokenExpiry = 3600
```

### Call Stack Display
Show the full call stack from entry function (depth 0) to current position:
```
  [0] AuthService.authenticateUser (src/auth/login.ts:18)
  [1] AuthService.validateCredentials (src/auth/login.ts:55)
  [2] bcrypt.compare (node_modules/bcrypt/index.js:10)  <- current
```

## Justification Generation

The **JustifierAgent** generates human-readable explanations for tracing decisions.

### Input
```typescript
{
  decisionType: "branch" | "dispatch",
  condition: "user.isAdmin",              // for branches
  implementations: ["AdminHandler", ...], // for dispatch
  chosenPath: "then",                     // what was chosen
  scenario: { scenarioId, scenarioName, scenarioDescription },
  variableState: { "user.isAdmin": "true" },
  codeSnippet: "if (user.isAdmin) { ... }"
}
```

### Output
```json
{
  "explanation": "The admin check evaluates to true because the user object has isAdmin set to true, granting access to the admin dashboard.",
  "confidence": 0.88,
  "assumptions": [
    "The user object was properly populated from the database",
    "isAdmin is a boolean field, not a role-based check"
  ]
}
```

### Quality Guidelines for Justifications
- Be specific — reference actual variable values and conditions
- Explain the "why" — connect the decision to the scenario narrative
- List assumptions — what must be true for this decision to hold
- Keep explanations concise but complete (1-3 sentences)
- Use domain language from the codebase (not generic terms)

## Interactive Commands

The walkthrough REPL supports:

| Command | Description |
|---------|-------------|
| `n` / `next` | Advance to next step |
| `p` / `prev` | Go back to previous step |
| `j <n>` / `jump <n>` | Jump to step number n |
| `vars` | Show variable state at current step |
| `why` | Show full AI justification |
| `correct` | Submit a correction for current step |
| `q` / `quit` | Exit the walkthrough |
| `help` / `?` | Show available commands |

## Integration with CodeGraph

### CLI Usage
```bash
codegraph walk user-login-flow    # Interactive walkthrough
codegraph view user-login-flow    # Rich scenario viewer (non-interactive)
```

### Graph Storage
- Scenarios: `(:Scenario)` nodes with properties matching the Scenario interface
- Steps: `(:ScenarioStep)` nodes linked via `(:Scenario)-[:HAS_STEP {order: N}]->(:ScenarioStep)`
- Consecutive steps: `(:ScenarioStep)-[:NEXT]->(:ScenarioStep)`
- Corrections: `(:Correction)-[:APPLIES_TO]->(:Scenario|:Function)`

### Local Storage
Scenarios and their steps are also stored as JSON files in `.vscode/code-graph/scenarios/` (one file per scenario, named `<scenario-id>.json`). This enables version control, portability, and offline access.

### After Walkthrough
Users can:
- Submit corrections (triggers re-trace of downstream steps)
- Validate the scenario (status -> `validated`)
- Export as JSON, Markdown, Mermaid diagrams, or Cypher queries
- Compare versions after corrections (`codegraph diff`)

## Response Format

For justifications: Respond ONLY with a JSON object containing `explanation`,
`confidence`, and `assumptions`. No markdown fences, no extra text.
