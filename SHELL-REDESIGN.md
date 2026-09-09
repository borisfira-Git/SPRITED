# SPRITED 0.8.0-preview.3 — independent product shell

The default product is now the four-step workspace shown in the supplied visual reference. This is not a modal overlay: `/ui/` serves `public/shell.html` with no old editor DOM, import tabs, core processing scripts, or legacy navigation. The service still uses the original engine behind the API.

## Launch and normal use

Run **SPRITED.exe** (or SPRITED-Library.cmd). Select/create a character, select one of six animation cards, Generate, review video, Redo or **Use Result**, choose 4/6/8/12/16/24 frames, Create SpriteSheet, Export PNG. Use Result approves the selected attempt using the existing review/memory operation; sheet creation is gated until that step. No Advanced Editor action is required.

`SPRITED-Advanced.exe` is the optional standalone legacy editor. **Open Advanced Editor** in the product opens a separate browser window/tab at `/ui/editor.html`. Export options can open the selected processed attempt there. Closing that window leaves the product unchanged. Normal default launch intentionally changed; saved data and automation behavior did not.

The library remains under the existing workspace (launcher default `%LOCALAPPDATA%/SPRITED`). If an older release server is still running, restart Windows before opening this release. Closing a browser does not stop the server.

## Reference layout

Navy full-page background; narrow thumbnail sidebar; numbered Character / Animation / Result / Sprite Sheet columns; large reference and video areas; blue Generate; green Use Result and PNG export; compact result arrows; collapsed secondary result/export actions. At narrower widths the columns become two rows, then a readable single column. Synthetic rectangle screenshots are test content, not generated characters.

Character actions live in the ellipsis menu. New Character requires only name and image. Rename preserves IDs, references, jobs and attempt snapshots. Trash/restore/purge are preserved. Settings has only Connections, Storage and Advanced Preferences; it does not contain old workflow pages.

Removed from the default shell: legacy editor navigation, import modes, video import, manual grid, frame editing, old processing panels, raw queue/provider controls, and Godot-specific controls. These remain in the separate expert editor where needed. Duration, loop, canvas, sampling and key/alignment preferences live in Settings → Advanced Preferences. Result rejection lives in Result options. Alternative registered files remain under More export options; normal export is PNG.

## Wiring

- Generate → existing jobs/create, after checking the live MCP bridge.
- Redo → existing attempts/redo; previous attempts remain.
- Use Result → existing animation/approve for the current attempt.
- Create SpriteSheet → existing spritesheet/create with selected count and processing preferences.
- Export PNG → authenticated registered sheet asset download.
- External editor handoff → existing animation/open and editor-project snapshot endpoint.
- Rename → small task-oriented character/rename action; no engine or format rewrite.

Connections retains the existing live heartbeat/expiry and copyable configuration. See CONNECTIONS-SETUP.md. Green means a connected MCP client, not proof of a generator. Real user extension connection and Guardian generation remain for the user's manual test. AUTO/SMART limitations remain unchanged. No model downloads, gait analysis or Godot work occurred.

## Main files

- public/shell.html, shell.css: independent shell document and reference-based layout.
- public/library-panel.js: shell controls using the existing API adapters.
- public/editor-bridge.js: separate expert window snapshot loading.
- automation/http.mjs: separate shell/editor routes and assets.
- desktop/ProductLauncher.cs and scripts/package-windows.ps1: default product executable and explicitly separate expert executable.
- public/character-workflow.js, static/app.js, automation/contracts.mjs: scoped rename operation only.
- tests/shell.test.mjs: independent DOM, hidden-editor full flow, offline/connected tests, result ingestion, use-result gate, 8/24 export, separate editor and responsive checks.

## Resume

Check CHECKPOINT.md for exact test results and current commit. Continue this existing repository. Next external milestone is the user's real MCP/provider test producing a genuine character video; do not substitute the synthetic test fixture for generation.
