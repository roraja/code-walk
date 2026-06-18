---
name: codewalk-podcast
description: "Use this skill when the user asks to 'create a podcast', 'generate podcast', 'make a podcast',
  'podcast from code walk', 'audio walkthrough', 'mp3 podcast', 'two person podcast',
  'codewalk podcast', 'narrate code walk', or when they want to generate a 2-person
  conversational MP3 podcast from a code walk (.codewalk.json) or scenario."
---

# Code Walk Podcast — Generate 2-Person Conversational MP3

Generate a natural-sounding 2-person podcast (MP3) from a code walk, scenario trace, or CL review. The podcast features two speakers discussing the code at a high level — explaining functionality, architecture, design decisions, issues, and edge cases in a conversational format.

## When to Use

- User has an existing code walk (v1 `.codewalk.json` or v2 directory with `manifest.codewalk.json`)
- User wants an audio summary of a CL, scenario, or code path
- User asks for "podcast", "mp3", "audio walkthrough", or "narrate"

## Content Guidelines — CRITICAL

The podcast must be **high-level and conversational**. It should sound like two engineers discussing code over coffee, NOT like reading source code aloud.

### DO
- Discuss **function names and class names** (e.g., "SetFileContents", "DataObjectImpl")
- Explain **what code does and why** (functionality, motivation, design decisions)
- Discuss **architecture** (process boundaries, IPC, COM interfaces, ownership)
- Highlight **issues, bugs, edge cases** found in review
- Explain **backward compatibility concerns** and migration strategies
- Use analogies and plain language for complex concepts

### DO NOT
- Read actual code syntax, variable declarations, or line numbers
- Mention specific line numbers (e.g., "line 1045")
- Read type signatures or template parameters
- Spell out code formatting (braces, semicolons, etc.)
- Read raw struct field assignments

### Tone
- Conversational, like a technical podcast (think "Software Engineering Daily" or "CppCast")
- One speaker (Sarah) is the expert who explains; the other (Michael) asks clarifying questions
- Natural back-and-forth with short questions and substantive answers
- Include reactions ("That's subtle", "Smart", "That's a real attack vector")

## Procedure

### Step 1: Read the Code Walk

Find and read the code walk. It may be:
- **V2 (directory):** `.vscode/code-graph/codewalks/<walk-id>/manifest.codewalk.json` + `<cell-id>.json` files
- **V1 (single file):** `.vscode/code-graph/codewalks/<walk-id>.codewalk.json`

Read ALL cells to understand the complete narrative. Pay attention to:
- Cell narratives (the main content to discuss)
- State/variables (for understanding data flow)
- Highlights annotations (for identifying key changes)
- Code review issues mentioned in narratives

### Step 2: Write the Podcast Script

Create a script file at `<walk-directory>/podcast-script.txt` (v2) or alongside the `.codewalk.json` (v1).

Format: `[Speaker] Dialogue text`

```
[Sarah] Welcome back! Today we're tracing how...
[Michael] That sounds complex. Where does it start?
[Sarah] It begins in the renderer process when...
```

#### Script Structure
1. **Opening** (30s) — Set context: what CL/scenario, why it matters
2. **Walkthrough** (bulk) — Trace the code path phase by phase, with questions and explanations
3. **Issues/Findings** (2-3 min) — Discuss bugs, edge cases, review findings
4. **Summary** (1 min) — Recap key takeaways

#### Script Length Guidelines
- Target ~10-15 minutes of audio
- ~150 words per minute of speech
- So aim for 1500-2250 words total
- Short Michael questions (1-2 sentences), longer Sarah explanations (3-8 sentences)

### Step 3: Generate Audio Segments

Use `edge-tts` to generate audio for each speaker segment:

**Voices:**
- Sarah: `en-US-AvaNeural` (Female, conversational, expressive)
- Michael: `en-US-AndrewNeural` (Male, conversational, warm)

**Rate:** `+5%` (slightly faster than default for natural podcast feel)

```python
import re, subprocess, os, json

# Parse script
with open('podcast-script.txt', 'r') as f:
    text = f.read()
parts = re.split(r'\[(\w+)\]\s*', text)
segments = []
for i in range(1, len(parts), 2):
    segments.append({"speaker": parts[i], "text": parts[i+1].strip()})

# Generate each segment
voices = {"Sarah": "en-US-AvaNeural", "Michael": "en-US-AndrewNeural"}
for i, seg in enumerate(segments):
    outfile = f"/tmp/podcast-segments/seg_{i:03d}.mp3"
    subprocess.run([
        "edge-tts", "--voice", voices[seg["speaker"]],
        "--rate", "+5%",
        "--text", seg["text"],
        "--write-media", outfile
    ], timeout=60)
```

### Step 4: Generate Silence Gap

Create a short silence between speakers for natural pacing:

```bash
ffmpeg -y -f lavfi -i anullsrc=channel_layout=mono:sample_rate=24000 \
  -t 0.3 -c:a libmp3lame -b:a 48k /tmp/podcast-segments/silence.mp3
```

### Step 5: Merge into Final MP3

Create a concat list and merge with ffmpeg:

```python
# Create concat list
lines = []
for i in range(len(segments)):
    lines.append(f"file '/tmp/podcast-segments/seg_{i:03d}.mp3'")
    lines.append(f"file '/tmp/podcast-segments/silence.mp3'")
with open('/tmp/podcast-segments/concat.txt', 'w') as f:
    f.write('\n'.join(lines))
```

```bash
ffmpeg -y -f concat -safe 0 -i /tmp/podcast-segments/concat.txt \
  -c:a libmp3lame -b:a 128k -ar 24000 -ac 1 \
  "<output-path>/podcast.mp3"
```

### Step 6: Save Output

Save the final MP3 alongside the code walk:
- **V2:** `<walk-directory>/podcast.mp3`
- **V1:** Same directory as the `.codewalk.json`

Also save the script as `podcast-script.txt` in the same location.

### Step 7: Cleanup

Remove temporary segment files from `/tmp/podcast-segments/`.

## Prerequisites

- `edge-tts` Python package installed (`pip install edge-tts`)
- `ffmpeg` available on PATH
- Internet access (edge-tts uses Microsoft Edge's online TTS)

## Example Output

```
.vscode/code-graph/codewalks/my-scenario/
├── manifest.codewalk.json
├── cell-0.json
├── cell-1.json
├── ...
├── podcast-script.txt    ← Generated script
└── podcast.mp3           ← Generated 15-minute MP3
```

## Important Notes

- **Never read code aloud** — discuss concepts, not syntax
- **Keep it conversational** — avoid lecture-style monologues
- **Variable values are for understanding, not narration** — say "the data is about 50 kilobytes" not "size equals 50000 type SIZE_T"
- **Reference functions by name** — "SetFileContents" not "the function at line 605"
- **Explain the WHY** — architecture decisions, backward compatibility reasons, security concerns
- **Highlight review findings** — bugs, edge cases, missing tests are great podcast material
