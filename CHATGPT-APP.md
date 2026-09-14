# SPRITED ChatGPT App

SPRITED 0.13.0-dev adds a remote Streamable HTTP MCP runtime for ChatGPT. The desktop application remains a development and compatibility target; it is not used by the deployed ChatGPT App.

## Deploy on Render

1. Push this repository to GitHub.
2. In Render, choose **New → Web Service** and connect the GitHub repository.
3. Select **Docker** as the runtime.
4. Set the Dockerfile path to `Dockerfile.chatgpt`.
5. Choose the **Free** instance for the initial deployment.
6. Add `SPRITED_REMOTE_TOKEN` as a secret environment variable. Use a long random value and never commit it.
7. Optionally set `SPRITED_DATA_ROOT=/app/data/chatgpt-app`. The image already uses this location by default.
8. Set the health check path to `/health` and deploy. Render supplies `PORT`; SPRITED reads it automatically and binds to `0.0.0.0` inside the container.
9. Copy the public Render HTTPS URL. The MCP endpoint is `https://<render-host>/mcp`.
10. Replace `https://REPLACE-WITH-RENDER-HOST/mcp` in `mcp.json` only after Render assigns the real host.

Register the remote endpoint in ChatGPT developer mode, then map the returned `plugin_asdk_app...` identifier when preparing the published plugin. A public directory submission needs production authentication supported by ChatGPT; the current bearer token is intended for private deployment testing.

## Persistence

Runtime animation images and exports live under `SPRITED_DATA_ROOT` and may disappear when a free Render instance is replaced or restarted. The service starts cleanly when the directory is empty. Compact Experience Learning and Updates data use the same root; mount a Render persistent disk later if those lessons must survive deploys. A database is not required for initial deployment.

The deployed runtime exposes only these task-oriented tools: prompt preparation, SpriteSheet analysis/slicing, GIF preview, validation, bad-frame discovery, repair prompt preparation, quality evaluation, learning summary, recent changes, and final GIF/SpriteSheet export. It accepts image bytes and stable IDs and never accepts arbitrary paths.

ChatGPT supplies the visual generation and semantic findings. SPRITED performs deterministic slicing, ordering, preview, technical/loop validation, repair planning, quality stop decisions, compact learning, and exports.
