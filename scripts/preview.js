#!/usr/bin/env node
const http = require("http");
const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");
const { build } = require("./build");

const PORT = Number(process.env.PORT) || 8080;
const DIST = path.join(__dirname, "..", "dist");
const WATCHED = [path.join(__dirname, "..", "site")];
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};
const BROWSER_OPENERS = { darwin: "open", win32: 'start ""', linux: "xdg-open" };

function safeBuild() {
  try {
    build();
  } catch (error) {
    console.error(`✗ ${error.message}`);
  }
}

function resolvePath(url) {
  let decoded;
  try {
    decoded = decodeURIComponent(new URL(url, "http://localhost").pathname);
  } catch {
    return null;
  }
  const file = path.join(DIST, decoded);
  const relative = path.relative(DIST, file);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return null;
  return file;
}

function sendFile(response, status, file) {
  response.writeHead(status, {
    "Content-Type": TYPES[path.extname(file).toLowerCase()] || "application/octet-stream",
    "Cache-Control": "no-store",
  });
  fs.createReadStream(file).pipe(response);
}

function sendNotFound(response) {
  const page = path.join(DIST, "404.html");
  if (fs.existsSync(page)) return sendFile(response, 404, page);
  response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  response.end("Page introuvable");
}

function serve(request, response) {
  const file = resolvePath(request.url);
  if (!file || !fs.existsSync(file)) return sendNotFound(response);
  if (!fs.statSync(file).isDirectory()) return sendFile(response, 200, file);

  const { pathname, search } = new URL(request.url, "http://localhost");
  if (!pathname.endsWith("/")) {
    response.writeHead(301, { Location: `${pathname}/${search}` });
    response.end();
    return;
  }
  const index = path.join(file, "index.html");
  if (!fs.existsSync(index)) return sendNotFound(response);
  sendFile(response, 200, index);
}

function watchSources() {
  let timer = null;
  const onChange = (event, name) => {
    if (name && path.basename(name) === "fr.json") return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      console.log(`↻ ${name} modifié, régénération…`);
      safeBuild();
    }, 200);
  };
  try {
    for (const dir of WATCHED) fs.watch(dir, { recursive: true }, onChange);
  } catch (error) {
    if (error.code !== "ERR_FEATURE_UNAVAILABLE_ON_PLATFORM") throw error;
    console.warn(`⚠ Node ${process.version} ne sait pas surveiller les dossiers sur ce système. Installez Node 20 ou plus récent, ou relancez le serveur après chaque modification.`);
  }
}

function openBrowser(url) {
  const opener = BROWSER_OPENERS[process.platform];
  if (!opener || process.env.NO_OPEN) return;
  exec(`${opener} "${url}"`, () => {});
}

function listen(port) {
  const server = http.createServer(serve);
  server.once("error", (error) => {
    if (error.code !== "EADDRINUSE") throw error;
    console.log(`Le port ${port} est déjà utilisé, essai du port ${port + 1}…`);
    listen(port + 1);
  });
  server.listen(port, () => {
    const url = `http://localhost:${port}/fr/`;
    console.log(`\nSite disponible sur ${url}`);
    console.log("Les modifications de src/ et lang/ sont prises en compte automatiquement. Rechargez la page.");
    console.log("Ctrl+C pour arrêter.\n");
    openBrowser(url);
  });
}

safeBuild();
watchSources();
listen(PORT);
