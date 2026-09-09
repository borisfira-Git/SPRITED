# SPRITED 0.8.0-preview.1 — Character Library

This extends the existing 0.7.0 desktop editor. It does not contain an AI animation generator.

## Open the library

In the Windows package, run **SPRITED-Library.cmd**. Node.js 22+ and Microsoft Edge must be installed. The launcher starts the localhost service and opens the connected library URL. Data lives in `%LOCALAPPDATA%/SPRITED`, independently of the release folder. The server continues running when the browser closes. Running the launcher again reconnects to it.

**SPRITED.exe** remains the existing standalone advanced editor. Its Character & Animation panel is a project-file workflow, separate from the connected library. The Character Library button explains how to open the connected mode. Neither the hosted React page nor a previously open standalone editor is remotely controlled.

For development or a chosen workspace, create a folder, then run from the source/release directory:

```powershell
node automation/cli.mjs serve --workspace C:/Sprites/Library
```

Open the printed **Library** URL. Its fragment contains a local access token; the UI stores it in session storage and removes it from the address bar. Do not share this URL/token. HTTP binds to 127.0.0.1. Cross-origin browser requests are rejected; the served UI may call its own origin with the token.

## Normal workflow

1. Click **Character Library**, expand **+ NEW CHARACTER**, enter a name and choose PNG/WebP. The reference is copied into managed storage.
2. Choose the character and animation. Set duration (0.3–5 seconds), Loop and final count (2–24).
3. Click **GENERATE**. This creates a persistent job for an external agent; it does not launch VS Code or invent a video.
4. The agent lists, claims and executes the job using its available generation capabilities, then submits a local video. Use **Refresh** to receive updates in the UI.
5. Select the attempt and **Preview video**. **APPROVE**, **REJECT** with a reason, or **REDO**. REDO queues a new variation request and preserves the previous attempt/video.
6. Choose the sprite count and **CREATE SPRITESHEET**. The existing extraction, key-color cleanup, right-foot/body alignment, normalization and renderer run on that stored video. Repeat with 24 frames without another generation.
7. PNG sheet and individual-frame download buttons appear under each saved sheet version. **OPEN IN ADVANCED EDITOR** loads the latest result for existing preview/edit/export controls.

The legacy run panel still exposes canvas, key color and alignment settings. In the connected library those processing settings can currently be changed through `animation configure` / its MCP equivalent. The normal library UI uses stored defaults (256×256, green key removal, recipe alignment).

## CLI (actual command names)

Use one workspace across all commands. Files supplied through automation must be inside that workspace. PNG/WebP references are limited to 9 MB/4 megapixels; videos to 250 MB.

```powershell
node automation/cli.mjs character create --name Guardian --path guardian.png --workspace C:/Sprites/Library --json
node automation/cli.mjs character list --workspace C:/Sprites/Library --json
node automation/cli.mjs jobs create --character-id CHARACTER_ID --animation-type WALKING --duration 1.5 --loop --frames 8 --sampling smart --workspace C:/Sprites/Library --json
node automation/cli.mjs jobs list --workspace C:/Sprites/Library --json
node automation/cli.mjs jobs claim JOB_ID --agent Cline --workspace C:/Sprites/Library --json
node automation/cli.mjs jobs submit-result JOB_ID --claim-token CLAIM_TOKEN --path generated/walk.mp4 --provider ACTUAL_PROVIDER --model ACTUAL_MODEL --workspace C:/Sprites/Library --json
node automation/cli.mjs animation approve ATTEMPT_ID --workspace C:/Sprites/Library --json
node automation/cli.mjs spritesheet create ATTEMPT_ID --frames 8 --sampling smart --workspace C:/Sprites/Library --json
node automation/cli.mjs spritesheet create ATTEMPT_ID --frames 24 --sampling uniform --workspace C:/Sprites/Library --json
node automation/cli.mjs attempts redo ATTEMPT_ID --workspace C:/Sprites/Library --json
```

Use `jobs release JOB_ID --claim-token TOKEN` to return a job to the queue or `jobs fail JOB_ID --claim-token TOKEN --error "reason"` to record failure. Approval accepts a received video before extraction. It represents the reviewer’s decision, not an automatic quality verdict.

Only one service owns a workspace. If the GUI/server is running, **do not start another workspace service**. Use the same commands with `--api http://127.0.0.1:47821` instead of `--workspace`, and put the printed token in `SPRITED_TOKEN` (or pass `--token`). This is also how MCP shares the GUI’s state.

## MCP / Cline / Codex

The existing stdio MCP entry point now advertises 49 tools, retaining all 12 original tools. A typical MCP configuration for the already running library server is:

```json
{
  "mcpServers": {
    "sprited": {
      "command": "node",
      "args": ["C:/PATH/TO/SPRITED/automation/cli.mjs", "mcp", "--api", "http://127.0.0.1:47821"],
      "env": {"SPRITED_TOKEN": "COPY_THE_LOCAL_SERVER_TOKEN"}
    }
  }
}
```

Without a GUI/server, use `mcp --workspace C:/Sprites/Library`; it owns and persists that workspace directly.

Agent sequence:

1. `sprited_list_generation_jobs`
2. `sprited_claim_generation_job` with job ID and agent name; keep the claim token.
3. Read the returned reference path, recipe, phase template, duration, loop constraints and scoped output directory. Paths in the job are relative to the configured workspace.
4. Use an actually available generation tool to produce continuous motion. SPRITED does not supply that tool.
5. Save the video inside the workspace and call **`sprited_submit_job_result`** with job ID, claim token, path, provider and optional model/seed. This is the claim-aware library submission tool. The older `sprited_submit_generation_result` is retained only for pre-library runs.
6. Reviewer uses `sprited_approve_animation` / `sprited_reject_animation_attempt` or the GUI.
7. `sprited_create_spritesheet_from_attempt`, then inspect `output_paths`.

No mouse/keyboard automation of VS Code is used. There is no push subscription or automatic agent launcher; the external agent must poll/list jobs and handle them. Claims are serialized by the service and persisted. Claims do not expire automatically; the owner releases them explicitly.

## API

Bearer authentication is required. Resource routes include:

- `GET /characters`, `GET /trash`, `GET /recipes`, `GET /providers`
- `POST /characters` (name/path), `POST /character/delete`, `/character/restore`, `/character/purge`
- `GET|POST /generation-jobs`
- `GET /generation-jobs/{id}`
- `POST /generation-jobs/{id}/claim`, `/release`, `/fail`, `/submit-result`
- `GET /attempts`, `POST /attempts/redo`, `/attempts/reject`
- `POST /animation/approve`, `/animation/open`, `/spritesheet/create`
- `GET /attempts/{id}/video` and registered PNG sheet assets for the connected UI

Canonical CLI action paths also remain available. GET listing responses can be filtered by the client. The external input schema is in `automation/contracts.mjs`.

## Persistence and compatibility

- `.sprited/session.json`: atomic durable project/library/queue state.
- `.sprited/references/`: managed copies of references; embedded reference data also travels with project snapshots.
- `SPRITED_DATA/characters/CHARACTER_ID/animations/TYPE/ATTEMPT_ID/`: job package, copied video, submission metadata and immutable derived sheet directories.
- Each sheet directory includes a sheet PNG, JSON, individual PNG frames, a project snapshot and the existing Godot resource.
- Soft deletion is a logical Trash flag: assets stay in their original managed locations. Restore retains all data. Pending claims are cancelled on Trash and are not automatically restarted on restore.
- Permanent deletion is available only from Trash with exact-name and `DELETE PERMANENTLY` confirmations. It removes managed character assets and unshared managed references. Cleanup failures are reported and recorded in `.sprited/pending-delete-*.json` for follow-up. User-owned original import files and independent manual exports are not deleted.

Project version remains 1 with an optional `workflow` extension (schema version 1). Old `.spriteproject` files open with an empty library extension. New projects carry recipes, reference snapshots, runs, jobs and memory. The React editor preserves this extension when saving, but its UI does not implement the new library. Older SPRITED releases may discard unknown fields on save: retain a backup. The connected library is workspace-scoped, so importing an old project through the service deliberately replaces that service’s project state; use a separate workspace for unrelated legacy projects.

## Honest status / limitations

**WORKING:** persistent multiple characters, references, six recipes, phase descriptions, queue/claim/release/fail, local video submission, separate attempt history, REDO requests, approval/rejection memory, connected video preview, same-video 8/24 extraction, PNG sheets/frames, advanced editor handoff, Trash/restore/permanent deletion, CLI/API/MCP. Existing Godot export remains available.

**PARTIAL:** templates specify ordered motion phases and constraints, not executable pose trajectories. Memory pre-fills approved settings and records provider metadata; it is not training or a calibrated provider-ranking system. Editor corrections are not automatically synchronized back into saved library attempts. UI refresh is manual. GUI advanced settings and per-animation grouping need refinement. Job processing progress is currently synchronous; only final process state is durably committed.

**PLACEHOLDER:** LocalAnimationProvider and StubProvider fail explicitly. AgentRoutedProvider queues work; it does not create video.

**NOT IMPLEMENTED:** temporal frame-sequence submission, motion-aware SMART selection, reliable leg alternation/face/weapon/anatomy validation, automatic external-agent execution, model management/downloads and heavy local generation. Non-loop extraction currently also excludes the exact clip endpoint; inspect the final pose. Changing frame count never triggers generation.

Validation reports geometry baseline drift, scale range, exact duplicate fraction, normalized pixel motion difference and loop-end difference. These have no calibrated semantic quality threshold. A `validated` status means checks ran; it does not prove a good walking cycle.

No real Guardian animation was generated during this milestone. Automated tests use an explicitly synthetic reference and a prerecorded synthetic moving rectangle to verify plumbing. They are not evidence of character consistency or gait quality.
