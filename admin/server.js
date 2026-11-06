#!/usr/bin/env node
const http = require("http");
const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");
const { build, loadData, DATA_FILE } = require("../scripts/build");
const { FIELDS, getPath, setPath, normalize, emptyFields, checklist } = require("./fields");
const { analyzeDeploy, diagnose, upload } = require("./ftp");
const { readJson, writeJson, readDeployConfig, DEPLOY_FILE, MANIFEST_FILE } = require("./storage");

const PORT = Number(process.env.ADMIN_PORT) || 8090;
const DIST = path.join(__dirname, "..", "dist");
const UI = path.join(__dirname, "ui");
const ALLOWED_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
};

let lastBuild = { problems: [], date: null };

function runBuild() {
  const { problems } = build();
  lastBuild = { problems, date: new Date().toISOString() };
  return lastBuild;
}

function tokenProblems(problems) {
  return problems.filter((problem) => problem.includes("{{"));
}

function sendJson(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(body));
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 100000) request.destroy();
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(body || "{}"));
      } catch {
        reject(new Error("JSON invalide"));
      }
    });
  });
}

function serveFile(response, file) {
  if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Introuvable");
    return;
  }
  response.writeHead(200, {
    "Content-Type": TYPES[path.extname(file).toLowerCase()] || "application/octet-stream",
    "Cache-Control": "no-store",
  });
  fs.createReadStream(file).pipe(response);
}

function previewFile(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath.replace(/^\/preview/, ""));
  } catch {
    return null;
  }
  const file = path.resolve(DIST, "." + decoded);
  const relative = path.relative(DIST, file);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) return path.join(file, "index.html");
  return file;
}

function isTrustedRequest(request) {
  if (!ALLOWED_HOSTS.has(request.headers.host)) return false;
  if (request.method !== "POST") return true;
  const origin = request.headers.origin;
  const sameOrigin = !origin || [...ALLOWED_HOSTS].some((host) => origin === `http://${host}`);
  return sameOrigin && (request.headers["content-type"] || "").startsWith("application/json");
}

async function handleApi(request, response, pathname) {
  if (request.method === "GET" && pathname === "/api/state") {
    const data = loadData();
    const deploy = readDeployConfig();
    const manifest = readJson(MANIFEST_FILE, {});
    return sendJson(response, 200, {
      data,
      deploy,
      empty: emptyFields(data),
      checks: checklist(data, deploy, lastBuild.problems),
      lastBuild,
      lastPublish: manifest.lastPublish || null,
      siteUrl: data.site?.url || "",
    });
  }

  if (request.method === "POST" && pathname === "/api/build") {
    await readBody(request);
    return sendJson(response, 200, runBuild());
  }

  if (request.method === "POST" && pathname === "/api/data") {
    const input = await readBody(request);
    const data = loadData();
    const errors = {};
    for (const field of FIELDS) {
      const { value, error } = normalize(field, getPath(input, field.path));
      if (error) errors[field.path] = error;
      else setPath(data, field.path, value);
    }
    const { open, close } = data.booking || {};
    if (open && close && close <= open) errors["booking.close"] = "doit être après la date d'ouverture";
    if (Object.keys(errors).length) return sendJson(response, 400, { errors });
    writeJson(DATA_FILE, data);
    const { problems } = runBuild();
    return sendJson(response, 200, { saved: true, problems, empty: emptyFields(data) });
  }

  if (request.method === "POST" && pathname === "/api/deploy") {
    const input = await readBody(request);
    const { config, issues } = analyzeDeploy(input, loadData().site?.url);
    writeJson(DEPLOY_FILE, config);
    return sendJson(response, 200, { saved: true, deploy: config, issues });
  }

  if (request.method === "POST" && pathname === "/api/diagnose") {
    const input = await readBody(request);
    const result = await diagnose(input.deploy || {}, input.password ? String(input.password) : "", loadData().site?.url);
    writeJson(DEPLOY_FILE, result.config);
    return sendJson(response, 200, result);
  }

  if (request.method === "POST" && pathname === "/api/publish") {
    const input = await readBody(request);
    const data = loadData();
    const missing = emptyFields(data);
    if (!input.password) return sendJson(response, 400, { message: "Le mot de passe FTP est vide." });
    if (missing.length) {
      const { issues } = analyzeDeploy(input.deploy || readDeployConfig(), data.site?.url);
      return sendJson(response, 400, { message: "Certaines valeurs du site sont vides.", empty: missing, issues });
    }

    const check = await diagnose(input.deploy || readDeployConfig(), String(input.password), data.site?.url);
    writeJson(DEPLOY_FILE, check.config);
    if (check.issues.length && check.stage !== "done") {
      const titles = { settings: "Les réglages OVH sont à corriger.", network: "Le serveur FTP est injoignable.", login: "La connexion FTP a été refusée.", done: "Le dossier du site est à vérifier." };
      return sendJson(response, 400, { message: titles[check.stage], issues: check.issues });
    }
    const config = check.config;
    const warnings = check.issues;

    const { problems } = runBuild();
    const broken = tokenProblems(problems);
    if (broken.length) return sendJson(response, 400, { message: "Une traduction contient un repère de donnée cassé.", problems: broken });

    response.writeHead(200, { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" });
    const emit = (event) => response.write(JSON.stringify(event) + "\n");
    warnings.forEach((warning) => emit({ type: "curl", message: warning.message }));
    try {
      const summary = await upload(config, String(input.password), Boolean(input.force), emit);
      if (!summary.failed.length) {
        const manifest = readJson(MANIFEST_FILE, {});
        manifest.lastPublish = { date: new Date().toISOString(), uploaded: summary.uploaded, removed: summary.removed, host: config.host };
        writeJson(MANIFEST_FILE, manifest);
      }
      emit({ type: "done", siteUrl: data.site?.url || "", ...summary });
    } catch (error) {
      emit({ type: "fatal", message: error.message });
    }
    return response.end();
  }

  return sendJson(response, 404, { message: "Introuvable" });
}

const server = http.createServer(async (request, response) => {
  if (!isTrustedRequest(request)) {
    response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    return response.end("Accès refusé");
  }
  const pathname = new URL(request.url, `http://${request.headers.host}`).pathname;
  try {
    if (pathname.startsWith("/api/")) return await handleApi(request, response, pathname);
    if (pathname === "/preview") {
      response.writeHead(301, { Location: "/preview/fr/" });
      return response.end();
    }
    if (pathname.startsWith("/preview/")) return serveFile(response, previewFile(pathname));
    if (pathname === "/") return serveFile(response, path.join(UI, "index.html"));
    if (pathname === "/admin.css" || pathname === "/admin.js") return serveFile(response, path.join(UI, pathname.slice(1)));
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    return response.end("Introuvable");
  } catch (error) {
    if (!response.headersSent) sendJson(response, 500, { message: error.message });
    else response.end();
  }
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`Le port ${PORT} est déjà utilisé. L'administration est peut-être déjà ouverte : http://localhost:${PORT}/`);
    process.exit(1);
  }
  throw error;
});

function openBrowser(url) {
  if (process.env.NO_OPEN) return;
  const command = { darwin: `open "${url}"`, win32: `start "" "${url}"` }[process.platform] || `xdg-open "${url}"`;
  exec(command, () => {});
}

try {
  runBuild();
} catch (error) {
  console.error(`✗ ${error.message}`);
}

server.listen(PORT, "127.0.0.1", () => {
  const url = `http://localhost:${PORT}/`;
  console.log(`\nAdministration disponible sur ${url} (uniquement depuis cet ordinateur)`);
  console.log("Ctrl+C pour arrêter.\n");
  openBrowser(url);
});
