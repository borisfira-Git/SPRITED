# Current checkpoint — SPRITED 0.8.0-preview.1

Updated 2026-09-09. Continue this existing clone. The latest user specification is the persistent Character Animation Library / external-agent job queue, not installing a local AI model. See `LIBRARY-GUIDE.md` for exact usage and honest feature status. Original 0.7.0 history is retained below.

## Current implementation

- Shared `public/character-workflow.js`: character library/reference snapshots, six recipes and phase templates, attempts, approved-setting memory, durable jobs, atomic claims/release/failure/submission, REDO variation requests, logical Trash/restore/purge.
- `static/app.js`: optional workflow project extension, shared-core dispatch, isolated per-run video processing, loop-safe uniform sampling, geometry/pixel metrics, editor handoff and sheet records. Existing image-processing algorithms were reused.
- `automation/service.mjs`: managed reference/video copies, durable session, scoped job output folders, separate 8–24 frame sheet derivations and PNG frame export, managed deletion, existing PNG/Godot pipeline.
- `automation/contracts.mjs`, `cli.mjs`, `http.mjs`, `mcp.mjs`: 49 tools; authenticated connected GUI and API; MCP/CLI can proxy to the already-running server without competing for the workspace lock.
- `public/library-panel.js`: connected multi-character/video-first UI. `public/character-panel.js`: earlier single-project run panel retained. `app/Sprited.tsx` only preserves metadata; no new React library UI.
- `automation/Open-Library.ps1` / `desktop/SPRITED-Library.cmd`: local library launcher with persistent `%LOCALAPPDATA%/SPRITED` storage. Existing `SPRITED.exe` remains standalone editor.

## Tests / state

Source library integration passed: restart persistence, two characters, claim collision/release, token rejection, copied result, video before extraction, REDO, approve, same-video 8/24 versions, connected video preview/editor handoff, real MCP-over-HTTP proxy. Synthetic fixture only, never a real generation claim.

Original automation and browser video regression suites passed, including PNG/Godot exports and rollback/path/auth checks. Static build and focused React TypeScript check passed. `video-browser.mjs` selector was narrowed to its own video dialog because the new library dialogs persist in the DOM. Packaged library integration also passed: the actual release service, HTTP, MCP proxy, GUI/video/editor, persistence, 8/24 outputs and permanent-delete confirmation/removal. Godot 4.5.1 loaded the packaged 8-frame atlas at 256×256 with duration 1.5 seconds (an unrelated root certificate warning was emitted). Logs live in the task's `work/` folder and a copied report is delivered under `outputs/`.

No real Guardian asset or actual external generator was executed. Local generation remains unconfigured; no model downloads occurred. Test workspaces contain synthetic jobs/attempts and must not be presented as production character content.

## Remaining milestone / exact continuation

1. Packaged tests are complete. Retain `tests/library.test.mjs` as the regression entry point; use `SPRITED_SERVICE_MODULE`, `SPRITED_HTTP_MODULE`, `SPRITED_CLI` for packaged entry points when new changes justify rerunning it.
2. Add a temporal frame-sequence submission contract and video preview equivalent. Current submission is video-only.
3. Improve the library screen: animation grouping, processing settings, automatic status refresh and explicit synchronization of advanced-editor corrections to a sheet version.
4. Add a calibrated motion-aware selector and real pose trajectories. SMART currently reports Uniform fallback; semantic gait/identity checks are unimplemented. Do not label geometry validation as good walking.
5. Exercise a real external agent/provider on an actual Guardian reference. Agent must claim a job, genuinely generate video, submit it, and have the user inspect it before approval. Do not fabricate completion with the synthetic test fixture.
6. Add explicit per-library/project switching so opening an unrelated old project cannot unintentionally replace the workspace library. Current service project/open deliberately replaces current state; use separate workspaces.

Claims do not auto-expire. Keep the claim token and release it on cancellation; server restart preserves claims. Trash cancels pending jobs but restore does not restart them. Models/providers remain swappable, but AUTO currently means agent queue unless using the legacy manual-video route.

Continuation test command from the source directory (set fresh workspace per test):

```powershell
$env:SPRITED_PLAYWRIGHT='C:/Users/User/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/index.mjs'
$env:SPRITED_TEST_WORKSPACE='../library-next-test'
$env:SPRITED_TEST_VIDEO='../test-results-final/motion-fixture.webm'
node tests/library.test.mjs
```

Changed/added files are the models/panels, static core/HTML, React metadata preservation, automation adapters/diagnostics/launcher, desktop launcher/version, build/preview/package scripts, tests, this checkpoint, guide and changelog. No existing source project was replaced.

---

# Historical checkpoint — SPRITED 0.7.0 local MVP

Updated 2026-09-09. Continue in this existing Git clone, not a new scaffold.

## Completed

- Identified and read the shared original conversation through 0.6.10.
- Located the original clean source repository and cloned its full history into this task's `work/SPRITED`.
- Audited architecture and wrote `AUDIT-AND-PLAN.md`.
- Implemented local video import in both GUI variants and a shared decoder.
- Added a service boundary over the portable editor's original processing and shared GUI/agent sheet builder.
- Added CLI, authenticated localhost API, 12 MCP tools, manifests, persistent sessions, validation, HTML preview and Godot export.
- Ran real video, CLI, service/HTTP, MCP and Godot checks; see the audit for exact results and limitations.

## Changed files

Existing: `static/app.js`, `static/index.html`, `app/Sprited.tsx`, `app/globals.css`, `scripts/build-static.mjs`, `scripts/preview.mjs`, `VERSION`, `CHANGELOG.md`, `desktop/SpritedLauncher.cs`, `desktop/README-WINDOWS.md`.

New: `public/video-import.js`, `public/video-import.d.ts`, `automation/{contracts,service,http,mcp,cli}.mjs`, `automation/sprited.cmd`, `automation/package.json`, `automation/example.manifest.json`, `automation/README.md`, `scripts/package-windows.ps1`, `tests/video-plan.test.mjs`, `tests/video-browser.mjs`, `tests/automation.test.mjs`, `tests/tsconfig.editor.json`, this checkpoint and the audit.

`tests/release-mcp.mjs` exercises every tool against the assembled Windows release. Its `SPRITED_RELEASE` environment variable can point to a new package folder.

## Packaged release verification

The Windows 0.7.0 launcher was compiled, with file version 0.7.0.0. The release includes Playwright Core (Node and Edge remain prerequisites). All 12 tools were exercised through the packaged MCP server: a 0.2–1.8 second range became 25 frames of 64 ms each, normalized by the existing canvas guides, exported as a 5×5 sheet and Godot resource. The geometric validator returned zero warnings after normalization. The raw synthetic fixture and result report are included in `demo` and `RELEASE-TEST.json`. This is a moving test shape, not an AI-generated character.

`align` preserves the reference anchor as in 0.6.10; `normalize` uses the existing “Match all frames to ruler + anchor” implementation to address canvas placement while preserving manual offsets. This distinction was verified after the first test revealed clipping when only the reference anchor was preserved.

Final regression fixes: explicitly seek even at time zero before reading pixels in headless Edge; set the project FPS from the clip timing when importing video into an empty project; revalidate the source-video path before extraction. The synthetic recorder now paints its initial frame before recording starts. Final GUI and automation suites passed after these changes, with logs retained in the task's `work/gui-final.log` and `work/automation-final.log`.

## Not implemented / not verified

- No AI video generator, motion transfer or general background segmentation.
- No live synchronization with a currently open GUI session. Open exported `project.spriteproject` in the GUI.
- Historical React/static geometry duplication remains; automation shares the shipping Windows/static implementation.
- No exhaustive codec or real Guardian animation QA yet. Validator is geometric, not anatomical.
- Full hosted Vinext build not validated in this environment; the static Windows build and focused React type check are the applicable local checks.
- No MCP client settings have been silently changed. A configuration example is delivered for the chosen workspace.

## Exact continuation

Open `automation/README.md`. Use the local release or this clone. Put a real animation clip beneath a chosen workspace, create a manifest based on `automation/example.manifest.json`, then invoke `project open`, `video extract`, `frames remove-background`, `frames align`, `animation validate`, and `export godot` (or the corresponding MCP tools). Inspect the generated preview and open the exported `.spriteproject` in SPRITED for visual correction. Keep the old 0.6.10 installation until the real-clip comparison passes.

## Test commands

```powershell
node --test tests/video-plan.test.mjs
node scripts/build-static.mjs
node node_modules/typescript/bin/tsc -p tests/tsconfig.editor.json
```

Integration test inputs are passed through `SPRITED_PLAYWRIGHT`, `SPRITED_TEST_WORKSPACE`, and `SPRITED_TEST_VIDEO`; `tests/video-browser.mjs` can create the motion fixture against `scripts/preview.mjs`. The current task has fixtures and logs in its `work/` directory. Only the new automation npm package needs Playwright; original application dependency versions were preserved.
