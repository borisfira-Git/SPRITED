# SPRITED audit and implementation plan — 2026-09-08

## Identified existing project

The shared conversation https://chatgpt.com/s/cx_6aa05d50ee448191acbfff16b02759d0 was opened and read in the browser. Its title is **תכנן כלי Sprite Sheet** and it ends at SPRITED 0.6.10. This matches the local Codex task `019f914c-c6da-7752-bf60-3acb99251ba4` and the repository below. The earlier `/share/6aa05cc9-...` link could not be fetched by the web tool; no architectural claims were inferred from that failure.

Original repository (left unchanged):
`C:/Users/User/.codex/visualizations/2026/07/23/019f914c-c6da-7752-bf60-3acb99251ba4/animasprite-site`

Baseline: clean Git working tree, commit `8fe10b5` (Align sprite frames by right foot in SPRITED 0.6.10), preceded by `25d4c30` and `a5b372b`.

Current development clone: `work/SPRITED` beneath this task workspace. It retains the original Git history and `.openai/hosting.json`. No new application was scaffolded; no site was created or deployed. Original release ZIPs remain in the July 24 task's `outputs/SPRITED` directory.

## Architecture found in code

| Component | Existing files / functions | Reuse decision |
|---|---|---|
| Windows desktop | `desktop/SpritedLauncher.cs` | Keep Edge app-mode launcher and file-based portable UI |
| Shipping portable editor | `static/index.html`, `static/app.js`, `app/globals.css` | Primary runtime for automation; preserve UI |
| React variant | `app/Sprited.tsx`, `app/page.tsx` | Preserve and add the shared video importer |
| Image processing | `makeFrame`, `alphaBounds`, chroma key, object extraction | Keep existing algorithms |
| Alignment | `prepareHeadToFeetFrames`, `normalize`, body/right-foot anchors | Call existing functions; keep one shared scale and manual offsets |
| Rendering/export | `drawFrame`, `renderedFrame`, `framesForExport`, `metadata`, `exportSheet` | Extract `buildSheet` and reuse it in GUI and automation |
| Project format | `snapshot`, `restore`, version-1 `.spriteproject` | Keep compatibility; add optional per-frame video provenance |
| Preview | Existing per-frame duration / FPS playback | Preserve durations extracted from the clip |
| Builds | `scripts/build-static.mjs`, `scripts/preview.mjs`, Vite/Vinext | Keep static build; add new asset to build and preview routes |

The app is not a Python/PySide application. The original Tauri/Rust suggestion in the early conversation was not the final shipped implementation. Core pixel functions are currently embedded in the static editor IIFE, with historical duplicated implementations in the React component. There was no existing CLI/API/MCP or video generator. `.openai/hosting.json` contains the existing Site ID; it was preserved.

## Implemented MVP

1. `public/video-import.js`: one decoder used by static and React interfaces. Local file picker, source preview, start/end, frame count, output size, error feedback and cancellation. Extraction completes before project mutation; source file is not modified or uploaded.
2. `SpritedCore.dispatch` inside the existing editor: a narrow boundary over its state and processing, avoiding a second set of alignment/chroma-key/rendering algorithms. This first boundary still requires a DOM/Canvas runtime; it is not yet a pure Node image library.
3. `automation/service.mjs`: headless Edge runtime, fixed operation dispatch, constrained file I/O, persistence, geometry validation orchestration, preview and Godot export. No clicks or selectors drive automation processing; calls invoke the service boundary directly.
4. `automation/cli.mjs`, `http.mjs`, `mcp.mjs`: adapters with structured results. 12 tools, authenticated localhost HTTP, serialized operations and a workspace lock.
5. Manifests and exported `.spriteproject` files allow GUI/agent handoff. Automation state is independent of an already-open GUI window.

## Next implementation stages

1. Validate against a real Guardian walk/attack clip and tune extraction size and sampling density. Compare body versus right-foot mode visually; a fixed image-space foot anchor is not always appropriate for moving walk cycles.
2. Consolidate historical React/static geometry code into shared modules incrementally, with pixel-output parity fixtures. Preserve the headless Canvas backend until an alternative proves identical. Do not rewrite the entire editor at once.
3. Add a generator-provider interface accepting character image, motion source and generation settings, returning a video plus provenance. Select a local model or explicit API provider only after hardware/provider constraints are known. This stage is not implemented.
4. Add temporal background segmentation and loop/motion QA separately from the geometric validator. Current warnings cannot determine whether the correct leg is leading or whether identity changed.
5. Improve large-project streaming, job cancellation/resume and cross-process session clients before raising the bounded MVP memory limits.

## Validation and known baseline issues

- Four sampling-plan tests pass (range, duration, no upscale, bounds/memory rejection).
- The final decoder explicitly seeks at time zero; this resolved a blank-first-frame race in headless Edge. Empty-project video import also sets the displayed FPS from sample duration, while appended clips preserve their individual frame durations.
- Real WebM integration passes: 8 distinct ordered frames, 250 ms/frame, undo/redo, cancellation, invalid-range rollback, chroma-key removal, common scale/body alignment and PNG export preserving manual position.
- CLI import and extraction ran as separate processes and restored the persisted session.
- Automation integration passes: manifest open, extract, keying, right-foot alignment, normalization, validation, preview, sheet dimensions, project export/reopen, output path confinement and HTTP authentication/Origin rejection.
- MCP stdio handshake, 12-tool discovery, structured results, errors and export pass against a live headless processing session.
- Godot 4.5.1 actually loaded the generated `.tres`, eight AtlasTextures of 256×256, and a total duration of two seconds. The sandbox emitted a nonfatal certificate-store warning; no network request was required.
- Static production build and editor-only TypeScript checking pass.
- The final portable package was exercised through every MCP tool with 25 frames over 1.6 seconds and a 5×5 export. Normalization against the canvas guides eliminated the fixture's clipping warnings. `RELEASE-TEST.json` records the structured results; the fixture is a synthetic moving shape, not character-generation evidence.
- Full repository TypeScript checking has pre-existing missing Cloudflare worker declarations (`Fetcher`, `D1Database`, `cloudflare:workers`). The broad starter tests still expect the original skeleton rather than SPRITED; they are not a valid app regression suite.
- Full Vinext build was not validated: the reused dependency directory is read-only here, causing `.vite-temp` write failure; the alternative config runner fails inside the existing asynchronous Cloudflare config. No hosting changes are part of this local release.

See `automation/README.md` for operation limits, setup and recovery. No claim is made that all historical GUI features or all codecs have been exhaustively tested.
