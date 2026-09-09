> Preview.3 update: SPRITED.exe now launches the independent four-step product. The legacy editor is SPRITED-Advanced.exe or Open Advanced Editor (separate window). See SHELL-REDESIGN.md for current navigation; older UI descriptions below are historical.

# SPRITED 0.8.0-preview.2 — manual MCP setup

**READY FOR USER MCP CONNECTION TEST.** Internal tests use a controlled MCP client and synthetic video. Your actual Cline/Codex configuration and real generation have NOT been tested or changed.

## Open the correct release

Extract the Windows ZIP to a permanent folder and open **SPRITED-Library.cmd**. Node.js 22+ and Microsoft Edge are prerequisites. **SPRITED.exe** is the preserved standalone advanced editor; use the Library launcher for the connected experience.

If the launcher reports an older server, restart Windows, then launch this release. Saved data remains under `%LOCALAPPDATA%/SPRITED`. Closing the browser alone does not stop a background server. Advanced users who started a server in their terminal may stop that specific server with Ctrl+C instead. Do not delete the data folder.

## Copy the exact configuration

1. In Library, click **Settings → Connections → Show Setup Instructions**.
2. Select **Cline JSON** or **Codex TOML** and click **Copy Configuration**. If clipboard access is unavailable, select the text and press Ctrl+C.
3. The displayed configuration contains the actual Node executable, release CLI path, running localhost port and current access token. Use that text, not the example placeholders below.
4. Configure your chosen agent manually. Do not replace unrelated MCP server entries.
5. Restart/reconnect the agent's MCP server, then return to SPRITED and click **TEST CONNECTION**.

For Cline, open its MCP server configuration editor and merge the `sprited` entry into the existing `mcpServers` object. Its configuration file location depends on the extension installation; use Cline's editor rather than guessing a filesystem path.

For Codex, the user configuration is `C:\Users\User\.codex\config.toml` (normally `~/.codex/config.toml`). Merge the copied tables manually, replacing an existing `sprited` table instead of duplicating it. The IDE also provides MCP server settings with STDIO command/arguments. See [official Codex MCP documentation](https://developers.openai.com/codex/mcp/).

Example Cline structure — values here are placeholders:

```json
{
  "mcpServers": {
    "sprited": {
      "command": "C:/Program Files/nodejs/node.exe",
      "args": ["C:/Apps/SPRITED/automation/cli.mjs", "mcp", "--api", "http://127.0.0.1:PORT"],
      "env": {"SPRITED_TOKEN": "COPY_CURRENT_TOKEN_FROM_CONNECTIONS"}
    }
  }
}
```

Equivalent Codex tables:

```toml
[mcp_servers.sprited]
command = "C:/Program Files/nodejs/node.exe"
args = ["C:/Apps/SPRITED/automation/cli.mjs", "mcp", "--api", "http://127.0.0.1:PORT"]

[mcp_servers.sprited.env]
SPRITED_TOKEN = "COPY_CURRENT_TOKEN_FROM_CONNECTIONS"
```

Keep the Library server running. Its port/token can change when restarted; copy fresh configuration if needed. Do not share the configuration or token. Use `--api` to join this live library; `--workspace` starts a separate owner and will conflict with an already-open workspace.

## Understand Test Connection

- Server **Ready**, Agent **Not Connected**, overall red **AI OFFLINE**: SPRITED is reachable but no live client session is registered.
- Server **Ready**, Agent **Connected**, overall green **AI READY**: an MCP client initialized and is sending heartbeats. This does **not** verify a generator, model, credits, or that the agent is handling the queue.
- Server **Unavailable**: local request/authentication failed. Reopen the correct library URL and retry.

MCP sends a heartbeat every 30 seconds. Closed sessions are removed; an abruptly terminated client can remain visible until the 90-second expiry. Restarting SPRITED clears all live sessions. Advanced Connection Details reports `generation_capability_verified: false` honestly.

## First user test

After Test Connection is green, load your character, choose WALKING and press GENERATE. Ask your agent:

> List SPRITED generation jobs, claim the queued WALKING job, and inspect its reference, motion template and output directory. Use a real available video-generation tool to make continuous motion. Submit the video using sprited_submit_job_result and the claim token. If no generator is available, report that and release the job; do not submit placeholder motion.

The integration is pull-based. An idle MCP connection does not automatically wake an agent or supply a model. Relevant tools: `sprited_get_connection_status`, `sprited_list_generation_jobs`, `sprited_claim_generation_job`, `sprited_release_generation_job`, `sprited_submit_job_result`, `sprited_create_spritesheet_from_attempt`. Outputs must stay in the scoped workspace.

The returned video appears automatically. Review it, approve/redo/reject, create an eight-frame sheet, then export PNG. Try 24 frames from the same video. This real extension/provider/Guardian test remains **NOT YET TESTED** until you perform it.

CLI diagnostics against the same live server (use its actual port and token):

```powershell
$env:SPRITED_TOKEN = 'your-current-token'
node automation/cli.mjs connections status --api http://127.0.0.1:PORT --json
node automation/cli.mjs jobs list --api http://127.0.0.1:PORT --json
```
