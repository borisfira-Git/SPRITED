# SPRITED for Windows

Current version: `0.6.1`

`SPRITED.exe` is a portable Windows launcher. It opens the local application
files in a dedicated Microsoft Edge application window.

## Requirements

- Windows 10 or Windows 11
- Microsoft Edge

No installation is required. Keep `SPRITED.exe` and the `app` folder together.
Project data is stored locally in the SPRITED browser profile under Local
AppData.

## Windows reputation

This build does not start a local web server and does not embed executable
payloads. A commercial code-signing certificate is still required to remove
the "Unknown publisher" warning on computers where the app has no reputation.

## Rebuilding

Compile `SpritedLauncher.cs` as a Windows executable and place these files in
an `app` folder next to it:

- `static/index.html`
- `app/globals.css` as `style.css`
- `static/app.js`
- `public/favicon.svg`
- `public/og.png`
