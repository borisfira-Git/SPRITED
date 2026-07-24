# AnimaSprite for Windows

`AnimaSprite.exe` is a portable Windows build. It embeds the complete application
and opens it in a dedicated Microsoft Edge application window.

## Requirements

- Windows 10 or Windows 11
- Microsoft Edge

No installation is required. Project data is stored locally in the user's
AnimaSprite browser profile under Local AppData.

## Rebuilding

Compile `AnimaSpriteLauncher.cs` with the .NET Framework C# compiler and embed:

- `static/index.html` as `AnimaSprite.index.html`
- `app/globals.css` as `AnimaSprite.style.css`
- `static/app.js` as `AnimaSprite.app.js`
- `public/favicon.svg` as `AnimaSprite.favicon.svg`
- `public/og.png` as `AnimaSprite.og.png`
