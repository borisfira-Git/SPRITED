# Current checkpoint — SPRITED 0.8.0-preview.3

2026-09-09. The user explicitly authorized replacement of the normal UI shell. The attached navy four-column image is the concrete visual target. This milestone is complete independently of any Godot or real AI provider test.

## Implemented

The default `/ui/` document is now `public/shell.html`, with no legacy editor DOM and no SpritedCore in its window. `public/library-panel.js` renders the independent four-column workflow against existing API operations. `public/shell.css` supplies the navy reference layout, thumbnail sidebar, large previews, six animation cards, numbered steps, result arrows, green Use Result/export and responsive two-column/single-column layouts.

Settings exposes Connections / Storage / Advanced Preferences. Old import/navigation/processing tabs are absent from the normal shell. Manual editing is a separate `/ui/editor.html` window, bridged by `public/editor-bridge.js`. The backend continues using the original engine. Source and API contracts retain existing actions, with one small added character/rename operation preserving IDs and references.

`SPRITED.exe` now uses desktop/ProductLauncher.cs to open the connected product. `SPRITED-Advanced.exe` is built from the retained SpritedLauncher.cs. SPRITED-Library.cmd remains an alias for product launch. Packaging includes both entry points and all shell assets. Saved projects and workspace data require no migration.

## Wiring

Generate → jobs/create; Redo → attempts/redo; Use Result → animation/approve on selected attempt; Create SpriteSheet → spritesheet/create; Export PNG → registered authenticated sheet asset. The sheet action is gated until Use Result. Reusing the same video for multiple frame counts does not create a generation job. Advanced editor handoff uses animation/open and the existing editor-project snapshot endpoint.

## Tests and evidence

PASS source shell: shell-preview3-test.log. PASS packaged independent shell: shell-preview3-packaged.log. The latter explicitly hides Open Advanced Editor during the entire create/generate/review/Use Result/8-and-24-frame/PNG workflow; checks no legacy import DOM or SpritedCore exists in the product page; checks offline generation gate, simulated live MCP client, setup JSON/TOML, automatic video receipt, separate editor window, rename, replacement, redo/history, restart, and 1000px responsive width. All assets/video are synthetic tests; NO real AI generation is claimed.

PASS library regression: library-preview3-test2.log (persistent data, claims, Trash/restore/permanent delete, shared-video sheets, processed 24-frame handoff into separate editor). Initial test needed an async status assertion correction after the UI change; corrected test passes.

PASS automation-preview3-test.log and character-preview3-test.log: existing CLI/API/MCP, authentication, path scope, rollback, project compatibility, processing, export and operational memory. PASS video-preview3-test.log: existing advanced editor video workflow, undo/redo, manual edits, cleanup, alignment and PNG. PASS connections unit test and static build. No new Godot runtime testing, model install or actual user extension configuration performed.

Packaged Windows GUI was tested through actual packaged service/HTTP/CLI/MCP and browser assets. Both Windows executables compiled; native product launcher code delegates to the existing startup script. Interactive double-click launcher behavior on the user's installed setup remains a user check (no user data/config touched).

Screenshots: work/shell-preview3-packaged/eight-frame-shell.png, simple-library.png, compact-shell.png, connections.png. They were visually inspected. Their rectangle assets are explicitly synthetic; they do not demonstrate Guardian quality.

## Files / version

Version 0.8.0-preview.3, assembly 0.8.0.3. See SHELL-REDESIGN.md for main files and usage. Additional touched files: automation/service.mjs asset registration, static/index.html expert script, scripts/build-static.mjs and preview.mjs expert bridge, version metadata, tests/library.test.mjs and ux.test.mjs (delegates to shell.test.mjs). Default launch is intentionally a breaking UI change; no project schema bump.

## Limits and next step

An MCP connection is not a video generator. The user still manually configures their actual extension using CONNECTIONS-SETUP.md, then asks a real available provider to process a queued character request. Source submission is video-only; AUTO sampling is Uniform and SMART remains fallback. Existing expert edits are not automatically written back to immutable library sheet versions. Previous engine/quality limits remain. Preview uses native video controls rather than custom-painted controls; supplied example character art is not bundled.

Next command for regression from source: set SPRITED_PLAYWRIGHT, SPRITED_TEST_VIDEO and a fresh SPRITED_TEST_WORKSPACE, then `node tests/shell.test.mjs`. To test a release set SPRITED_SERVICE_MODULE, SPRITED_HTTP_MODULE and SPRITED_CLI to its automation entry points. Continue in this existing repository. Do not reintroduce the old UI underneath the shell.

---

EOF
# Current checkpoint — SPRITED 0.8.0-preview.2

Updated 2026-09-09. Continue this existing codebase; previous checkpoint/history remains below. Current task is UX simplification and manual external-agent connection readiness. No real user extension configuration is authorized in this milestone.

## Implemented this milestone

- public/library-panel.js: clean character sidebar/reference, explicit creation/replacement, six animations, animation-scoped history, offline Generate gate, automatic four-second result/video polling, simple review/redo, 8-frame default, 4/6/8/12/16/24 selection, sheet preview and PNG export. Advanced controls and export variants are collapsed. Selectors disable during updates to prevent dropped selection changes.
- automation/connections.mjs: volatile live sessions, 30-second MCP heartbeat with 90-second expiry; server readiness is separate from external connection. Generation capability is never inferred from green status.
- automation/{contracts,service,http,cli,mcp}.mjs: task-oriented connection status/setup/heartbeat/disconnect, reference replacement, existing sheet processing options and registered output downloads. MCP remains stdio with a localhost API proxy.
- public/character-workflow.js and static/app.js: reference replacement through shared core and default eight-frame DEATH recipe. Existing snapshots retain their defaults. Sheet derivation preserves prior video approval.
- automation/Open-Library.ps1: reconnect only to this release's CLI path; a different old live server gives restart guidance instead of silently opening obsolete UI.
- VERSION, automation/package.json, desktop/SpritedLauncher.cs, static/index.html: 0.8.0-preview.2 branding/package metadata.
- tests/connections.test.mjs and tests/ux.test.mjs added; tests/library.test.mjs adapted to auto-open/video UI; release MCP version updated.
- LIBRARY-GUIDE.md, CONNECTIONS-SETUP.md, CHANGELOG.md and package documentation list updated.

## Verification checkpoint

INTERNALLY TESTED: source connection expiry; source UX with controlled MCP client; full source library persistence/Trash/editor/sheets; original core CLI/API/MCP/PNG/Godot regression; static build. An initial library test exposed an ignored rapid selection during refresh; selectors now disable during updates and the rerun passed.

Windows package outputs/SPRITED-0.8.0-preview.2 was built; executable metadata is 0.8.0.2 / 0.8.0-preview.2. Packaged UX PASSED using its service, HTTP, CLI/MCP proxy and GUI assets; screenshots were inspected. 54 MCP tools register. Source character-workflow and browser video regression PASSED. Logs: work/ux-preview2-packaged.log, library-preview2-test2.log, automation-preview2-test.log, character-preview2-test.log, video-preview2-test.log. Earlier source UX: ux-test-01.log. Static build and JavaScript/PowerShell syntax checks passed.

Godot: exported resource structure passed automation tests and headless asset import completed. Final Godot 4.5.1 load/check process crashed with signal 11 twice, including a compatibility-renderer retry; runtime load for preview.2 is NOT VERIFIED. Logs: work/godot-check-preview2/{import,run,retry}.log. Prior preview.1 runtime success is historical only. Native SPRITED.exe was compiled/version-checked; this task exercised the connected packaged browser GUI, not a fresh manual native-shell session.

READY FOR USER TEST: manual MCP configuration from Settings → Connections; use the generated configuration with actual executable/path/port/token. See CONNECTIONS-SETUP.md.

NOT YET TESTED: the user's Cline/Codex extension, a real external model, Guardian WALKING/ATTACK, semantic identity/gait quality. No model files downloaded. No actual external user connection is claimed.

## Compatibility and known limits

Project format remains version 1 with optional workflow extension. Library data stays in the existing workspace; no destructive migration. Standalone advanced editor and import/export processing are retained. Old readers may drop unknown metadata: keep project backups. Use a separate workspace when importing unrelated legacy projects because service project/open replaces that workspace's current state.

AUTO sampling is Uniform; SMART explicitly falls back to Uniform. Static sheet preview plus existing video/editor animation playback. Agent integration is pull-based: a live MCP session does not launch a generator or wake an idle agent. UI polling is four seconds; abrupt agent exits may remain green up to 90 seconds. Connection endpoints share service serialization, so long processing can delay status. Source submission remains video-only. Semantic gait/face/equipment validation and learned model ranking remain unimplemented. Advanced editor corrections do not automatically update stored attempt versions.

User clarification at delivery: Godot runtime testing is NOT required. Successful spritesheet PNG creation/export is the acceptance criterion and has passed, including packaged 8/24-frame reuse and browser download. Do not spend further time on Godot for this milestone.

## Exact continuation

After delivering preview.2, USER manually follows CONNECTIONS-SETUP.md and tests their extension. The next development milestone is a real available provider returning a genuine Guardian WALKING video through claim/submit-result, followed by visual review and exports. Do not use synthetic fixtures as evidence of real generation.

Regression entry points: tests/ux.test.mjs and tests/library.test.mjs. Set SPRITED_PLAYWRIGHT, SPRITED_TEST_VIDEO and a fresh SPRITED_TEST_WORKSPACE. For a packaged test set SPRITED_SERVICE_MODULE, SPRITED_HTTP_MODULE and SPRITED_CLI to the extracted release files. Test data and logs are under the task work/ folder, outside source control.

---

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
