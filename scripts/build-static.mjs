import { mkdir, readFile, writeFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const html = await readFile(new URL("static/index.html", root), "utf8");
const css = await readFile(new URL("app/globals.css", root), "utf8");
const js = await readFile(new URL("static/app.js", root), "utf8");
const video = await readFile(new URL("public/video-import.js", root), "utf8");
const workflow = await readFile(new URL("public/character-workflow.js", root), "utf8");
const panel = await readFile(new URL("public/character-panel.js", root), "utf8");
const library = await readFile(new URL("public/library-panel.js", root), "utf8");
const og = await readFile(new URL("public/og.png", root));

const worker = `const assets = {
  "/library-panel.js": { type: "text/javascript; charset=utf-8", body: ${JSON.stringify(library)} },
  "/character-workflow.js": { type: "text/javascript; charset=utf-8", body: ${JSON.stringify(workflow)} },
  "/character-panel.js": { type: "text/javascript; charset=utf-8", body: ${JSON.stringify(panel)} },
  "/": { type: "text/html; charset=utf-8", body: ${JSON.stringify(html)} },
  "/index.html": { type: "text/html; charset=utf-8", body: ${JSON.stringify(html)} },
  "/style.css": { type: "text/css; charset=utf-8", body: ${JSON.stringify(css)} },
  "/app.js": { type: "text/javascript; charset=utf-8", body: ${JSON.stringify(js)} },
  "/video-import.js": { type: "text/javascript; charset=utf-8", body: ${JSON.stringify(video)} },
  "/og.png": { type: "image/png", base64: ${JSON.stringify(og.toString("base64"))} }
};
function decodeBase64(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
export default {
  async fetch(request) {
    const url = new URL(request.url);
    const asset = assets[url.pathname];
    if (!asset) return new Response("Not found", { status: 404 });
    const body = asset.base64 ? decodeBase64(asset.base64) : asset.body;
    return new Response(body, {
      headers: {
        "content-type": asset.type,
        "cache-control": url.pathname === "/" || url.pathname === "/index.html"
          ? "no-cache"
          : "public, max-age=31536000, immutable",
        "x-content-type-options": "nosniff",
        "referrer-policy": "strict-origin-when-cross-origin"
      }
    });
  }
};
`;

await mkdir(new URL("dist/server/", root), { recursive: true });
await writeFile(new URL("dist/server/index.js", root), worker);
console.log("Built dist/server/index.js");
