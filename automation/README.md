# SPRITED automation 0.8.0-preview.1

The new connected Character Library, job queue and 49-tool MCP workflow are documented in `../LIBRARY-GUIDE.md`. Use `mcp --api http://127.0.0.1:47821` with `SPRITED_TOKEN` when the library GUI/server already owns the workspace. The new `/ui/` interface shares the server library; the standalone editor below remains independent. No AI generator is included.

## Original 0.7.0 processing commands (retained)

Requires Windows, Microsoft Edge and Node.js 22 or newer. The portable distribution includes `playwright-core`; when running from source, run `npm install` in this directory. There are no AI API calls, paid services or uploads.

The supported desktop GUI and automation execute the same functions in `static/app.js` (`SpritedCore` service boundary). Canvas runs in a dedicated headless Edge process for automation. CLI, HTTP and MCP are thin adapters over `Service`. This is independent of the visible GUI session: exchange `.spriteproject` files to transfer work; it does not live-control an already-open editor window. The existing React implementation remains available and shares the new video decoder, but the historical duplication of the older React/static processing has not yet been consolidated.

## CLI

From the release folder, with an existing workspace folder containing your video:

```powershell
node automation/cli.mjs project open walk.json --workspace C:/Sprites/Guardian --json
node automation/cli.mjs video import source/walk.mp4 --workspace C:/Sprites/Guardian --json
node automation/cli.mjs video extract --start 0.2 --end 1.8 --frames 25 --workspace C:/Sprites/Guardian --json
node automation/cli.mjs frames remove-background --color '#00ff00' --workspace C:/Sprites/Guardian --json
node automation/cli.mjs frames align --mode right_foot --workspace C:/Sprites/Guardian --json
node automation/cli.mjs animation validate --workspace C:/Sprites/Guardian --json
node automation/cli.mjs animation preview --workspace C:/Sprites/Guardian --json
node automation/cli.mjs spritesheet build --cols 5 --workspace C:/Sprites/Guardian --json
node automation/cli.mjs export godot godot --cols 5 --workspace C:/Sprites/Guardian --json
```

`sprited.cmd` wraps the same CLI. `help` lists commands. Without `--json`, results are indented; with it, each command emits one JSON object. Errors return exit code 1. An operation always returns `success`, `result`, `warnings`, `errors`, `output_paths`.

`project open` accepts the existing version-1 `.spriteproject` format or a manifest like `example.manifest.json`. Manifest paths are relative to the manifest; CLI video paths are relative to `--workspace`. The selected video and project state persist in `.sprited/session.json` between commands. Build/export writes a PNG, JSON, a GUI-compatible `project.spriteproject`, and a readable manifest in a unique output directory. Godot export adds `animation.tres`: copy the whole output folder into the Godot project and assign the resource to AnimatedSprite2D's Sprite Frames.

## MCP (recommended for agents)

Configure a stdio server in the agent's MCP settings. Replace the two paths:

```json
{
  "mcpServers": {
    "sprited": {
      "command": "node",
      "args": ["C:/Tools/SPRITED-0.7.0/automation/cli.mjs", "mcp", "--workspace", "C:/Sprites/Guardian"]
    }
  }
}
```

12 tools are exposed, including all 11 requested tools and `sprited_preview_animation`. The MCP process owns a persistent headless session; it needs no HTTP server. It uses newline-delimited JSON-RPC stdio, protocol version `2025-06-18`, and returns structured tool results. No shell execution, generic file writes or arbitrary browser evaluation is exposed.

## Local API

```powershell
node automation/cli.mjs serve --workspace C:/Sprites/Guardian --port 47821
```

The server prints a token at startup (or uses `SPRITED_TOKEN`). Every request needs `Authorization: Bearer <token>`. It binds only to `127.0.0.1`, checks Host, rejects browser Origin headers, and exposes no CORS access. `GET /status`, `GET /frames/get`; all other command paths use POST with JSON arguments, e.g. `POST /video/extract` with `{"start":0.2,"end":1.8,"frames":25}`. Bodies are limited to 64 KB. The API is optional; no network listener starts in CLI/MCP mode.

## Boundaries and recovery

- One automation owner per workspace prevents lost updates. Stop MCP/API before invoking standalone CLI against the same workspace. HTTP requests within a server are serialized.
- On graceful shutdown the lock is removed. After a hard crash, verify that the PID in `.sprited/automation.lock` is no longer running before removing that one lock file.
- Files must remain within the configured workspace after resolving symlinks/junctions. Only media/project imports and generated SPRITED outputs are permitted. Existing user export files are not overwritten: each build receives a unique subdirectory.
- Processing failures restore the previous in-memory state; successful mutations atomically replace the session file. A machine crash during export may leave a partial new export directory; the prior session remains available.
- MVP limits: 120 automation frames; 32 megapixels across decoded project frames; 250 MB input videos; 64–1024 px extraction size; at most 64 megapixels / 16384 px per sheet side. Existing GUI image import is unchanged.
- Extraction samples timestamps, not codec frame indices; very dense sampling may repeat decoded frames. Per-frame durations preserve the selected clip duration. End timestamp is excluded for loop-friendly sampling.
- Background removal is chroma key, not general AI segmentation. Geometry validation does not certify correct walking, limbs, character identity or seamless loops. Right-foot detection uses the existing image-space heuristic; it cannot infer anatomical left/right reliably.
- No video generator or motion-transfer model is implemented. An existing animation video is required.

Protocol references: [stdio](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports), [tools](https://modelcontextprotocol.io/specification/2025-06-18/server/tools).
