import { createServer } from "node:http";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const routes = {
  "/": ["static/index.html", "text/html; charset=utf-8"],
  "/index.html": ["static/index.html", "text/html; charset=utf-8"],
  "/style.css": ["app/globals.css", "text/css; charset=utf-8"],
  "/app.js": ["static/app.js", "text/javascript; charset=utf-8"],
  "/video-import.js": ["public/video-import.js", "text/javascript; charset=utf-8"],
  "/og.png": ["public/og.png", "image/png"],
};

const server = createServer(async (request, response) => {
  const route = routes[new URL(request.url || "/", "http://localhost").pathname];
  if (!route) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }
  response.setHeader("content-type", route[1]);
  response.end(await readFile(new URL(route[0], root)));
});

server.listen(Number(process.env.SPRITED_PORT || 4173), "127.0.0.1", () => {
  console.log(`http://127.0.0.1:${server.address().port}`);
});
