# SPRITED 0.8.0-preview.4 — startup recovery

The old launcher treated any existing automation.lock as active and rejected a reachable server from another release directory. Closing a visible browser does not stop its Node service. During diagnosis the user's recorded PID 7816 was still alive and its authenticated setup endpoint identified a preview.3 server running from a temporary archive extraction directory. No user data or process was modified during diagnosis.

## New behavior

- The service lock stores PID, executable, process creation time and an ownership nonce. Dead owners and provably reused PIDs are stale. Old numeric PID locks are still supported.
- Only the stale automation.lock is removed; the character library, projects, references, jobs and results are preserved. Empty abandoned lock files recover too. A live unverified owner is retained rather than guessed or killed.
- A Windows OS mutex serializes simultaneous lock recovery. It disappears when its helper exits, and abandoned mutex ownership is recoverable. Release checks the ownership nonce/content so one service cannot remove another service's lock.
- The launcher verifies authenticated SPRITED identity, workspace and actual listening PID before reconnecting. Older releases use authenticated setup plus workspace lock PID and port owner. Executable name alone is never enough.
- When Windows blocks CIM/network inspection, native process metadata and netstat provide a fallback. Unknown identity is logged; no unrelated process is terminated.
- A stale URL marker or unrelated occupied port does not prevent startup. New launcher services bind to port zero, letting Windows select a free localhost port. The normal CLI default remains 47821.
- A verified old SPRITED server is reused instead of rejected merely because its CLI path differs. That session continues serving its existing version until it exits; its data stays in the same workspace.
- Service spawning uses detached processes and explicit log file handles. The native launcher waits for the startup process, not for EOF from stderr inherited by a background descendant.
- Normal errors are a short message directing the user to logs. PowerShell stack traces are not inserted into the native error dialog.

## Logs

In the workspace (default `%LOCALAPPDATA%/SPRITED`):

- `startup.log`: detected PID, process existence, executable identity, port/owner, lock path, verification method and cleanup action. No access token is written here.
- `library-server.log`: service URL/token and normal output (local private connection information).
- `library-server-errors.log`: service errors.

No new persisted PID/port marker is required; the existing log URL is only a hint and must be verified. The actual lock is `.sprited/automation.lock`.

## Files

- automation/Open-Library.ps1: launcher identity/port checks, fallback inspection, startup serialization and friendly errors.
- automation/lock.mjs: process-aware stale lock recovery and ownership-safe release.
- automation/spawn-service.mjs: detached service startup with explicit log handles.
- automation/service.mjs: shared lock acquisition/release; processing logic unchanged.
- automation/http.mjs: authenticated `/identity` endpoint.
- automation/cli.mjs: explicit `--port 0` support; existing default unchanged.
- desktop/ProductLauncher.cs: no inherited-stderr blocking or raw script error display.
- tests/startup.test.mjs and tests/lock.test.mjs: startup and stale-lock acceptance cases.

## Use

Extract the ZIP to a permanent folder, then open SPRITED.exe. Do not launch directly inside an archive preview. Recovery is automatic; do not delete `.sprited` or library folders. Existing live automation sessions retain their locks. If a live owner's identity cannot be verified, check startup.log rather than deleting the lock blindly.

`powershell.exe -NoProfile -ExecutionPolicy Bypass -File automation/Open-Library.ps1 -DataDirectory C:/Sprites/Test -NoOpen` verifies startup/reconnection without opening a browser, for automated tests. Normal launch omits NoOpen.
