# Checkpoint — SPRITED 0.7.0 local MVP

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
