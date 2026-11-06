#!/usr/bin/env node
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const dns = require("dns").promises;
const net = require("net");
const { spawn, exec } = require("child_process");
const { build, loadData, DATA_FILE } = require("./build");

const PORT = Number(process.env.ADMIN_PORT) || 8090;
const ROOT = __dirname;
const DIST = path.join(ROOT, "dist");
const ADMIN_PAGE = path.join(ROOT, "admin", "index.html");
const DEPLOY_FILE = path.join(ROOT, "deploy.config.json");
const MANIFEST_FILE = path.join(ROOT, ".deploy-manifest.json");
const ALLOWED_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);

const FIELDS = [
  { path: "site.url", type: "url" },
  { path: "site.forceHttps", type: "boolean" },
  { path: "booking.open", type: "date" },
  { path: "booking.close", type: "date" },
  ...["low", "mid", "high"].flatMap((season) => [
    { path: `seasons.${season}.night`, type: "price" },
    { path: `seasons.${season}.week`, type: "price" },
    { path: `seasons.${season}.minNights`, type: "integer", min: 1, max: 60 },
  ]),
  { path: "checkin", type: "time" },
  { path: "checkout", type: "time" },
  { path: "payment.deposit", type: "integer", min: 0, max: 100 },
  { path: "payment.balanceDaysBefore", type: "integer", min: 0, max: 365 },
  { path: "payment.securityDeposit", type: "price" },
  { path: "payment.securityDepositReturnDays", type: "integer", min: 0, max: 365 },
  { path: "payment.freeCancellationDays", type: "integer", min: 0, max: 365 },
  { path: "form.web3formsKey", type: "text" },
  { path: "form.minNights", type: "integer", min: 1, max: 60 },
];

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

function getPath(object, dottedPath) {
  return dottedPath.split(".").reduce((node, key) => (node == null ? undefined : node[key]), object);
}

function setPath(object, dottedPath, value) {
  const keys = dottedPath.split(".");
  const last = keys.pop();
  const parent = keys.reduce((node, key) => (node[key] ??= {}), object);
  parent[last] = value;
}

function normalize(field, raw) {
  if (field.type === "boolean") return { value: raw === true || raw === "true" };
  if (raw === null || raw === undefined || String(raw).trim() === "") return { value: null };
  const text = String(raw).trim();
  if (field.type === "text") return { value: text };
  if (field.type === "url") {
    return /^https?:\/\/[^\s/]+\.[^\s/]+$/.test(text.replace(/\/+$/, "")) ? { value: text.replace(/\/+$/, "") } : { error: "adresse complète, par exemple https://www.tospitimas.fr" };
  }
  if (field.type === "date") {
    const valid = /^\d{4}-\d{2}-\d{2}$/.test(text) && !Number.isNaN(Date.parse(`${text}T00:00:00Z`));
    return valid ? { value: text } : { error: "date au format AAAA-MM-JJ" };
  }
  if (field.type === "time") {
    return /^([01]\d|2[0-3]):[0-5]\d$/.test(text) ? { value: text } : { error: "heure au format HH:MM" };
  }
  const number = Number(text.replace(",", "."));
  if (!Number.isInteger(number)) return { error: "nombre entier attendu" };
  const min = field.min ?? 0;
  if (number < min || (field.max !== undefined && number > field.max)) {
    return { error: field.max !== undefined ? `entre ${min} et ${field.max}` : `${min} ou plus` };
  }
  return { value: number };
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8").replace(/^﻿/, ""));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
}

function readDeployConfig() {
  return { host: "", user: "", remoteDir: "www", tls: true, ...readJson(DEPLOY_FILE, {}) };
}

function emptyFields(data) {
  return FIELDS.filter((field) => getPath(data, field.path) == null).map((field) => field.path);
}

let lastBuild = { problems: [], date: null };

function runBuild() {
  const { problems } = build();
  lastBuild = { problems, date: new Date().toISOString() };
  return lastBuild;
}

function checklist(data, deploy) {
  const empty = emptyFields(data);
  const today = new Date().toISOString().slice(0, 10);
  const close = data.booking?.close;
  const translationProblems = lastBuild.problems.filter((problem) => problem.startsWith("lang/"));
  return [
    { ok: empty.length === 0, label: "Toutes les valeurs sont remplies", detail: empty.length ? `${empty.length} champ(s) vide(s), en rose ci-dessous.` : "" },
    { ok: Boolean(data.form?.web3formsKey), label: "Clé Web3Forms renseignée", detail: data.form?.web3formsKey ? "" : "Sans elle, les demandes de réservation n'arrivent nulle part." },
    { ok: Boolean(close && close >= today), label: "Période de location à venir", detail: close && close < today ? "La date de fermeture est passée : le formulaire refusera toutes les dates." : "" },
    { ok: translationProblems.length === 0, label: "Traductions complètes", detail: translationProblems.join(" ; ") },
    { ok: Boolean(deploy.host && deploy.user), label: "Réglages FTP OVH renseignés", detail: deploy.host ? "" : "Voir la section Hébergement OVH." },
    { ok: Boolean(data.site?.forceHttps), label: "HTTPS forcé", detail: data.site?.forceHttps ? "" : "Désactivé : les visiteurs peuvent arriver sur l'adresse non sécurisée.", optional: true },
  ];
}

function tokenProblems(problems) {
  return problems.filter((problem) => problem.includes("{{"));
}

function listFiles(dir, base = dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listFiles(full, base);
    return [path.relative(base, full).split(path.sep).join("/")];
  });
}

function hashFile(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function curlQuote(value) {
  return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function remoteUrl(config, relativePath) {
  const dir = config.remoteDir.replace(/^\/+|\/+$/g, "");
  const segments = [...(dir ? dir.split("/") : []), ...relativePath.split("/")];
  return `ftp://${config.host}/${segments.map(encodeURIComponent).join("/")}`;
}

function runCurl(configText, onLine) {
  return new Promise((resolve, reject) => {
    const child = spawn("curl", ["-K", "-"], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.on("error", (error) => {
      reject(error.code === "ENOENT" ? new Error("curl est introuvable sur cet ordinateur.") : error);
    });
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      const lines = stdout.split("\n");
      stdout = lines.pop();
      lines.filter(Boolean).forEach(onLine);
    });
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("close", (code) => {
      if (stdout) onLine(stdout);
      resolve({ code, stderr: stderr.trim() });
    });
    child.stdin.end(configText);
  });
}

function connectionLines(config, password, createDirs = true) {
  const lines = [`user = ${curlQuote(`${config.user}:${password}`)}`, "silent", "show-error", "connect-timeout = 20"];
  if (createDirs) lines.push("ftp-create-dirs");
  if (config.tls !== false) lines.push("ssl-reqd");
  return lines;
}

const OVH_FTP_HOST = /^ftp\.cluster\d{3}\.hosting\.ovh\.net(:\d+)?$/i;
const OVH_EXAMPLE = "ftp.cluster0XX.hosting.ovh.net";

function issue(field, message, fix) {
  return fix ? { field, message, fix } : { field, message };
}

function suggestHost(host) {
  let candidate = host.replace(/\s+/g, "").replace(/^[a-z]+:\/\//i, "").split("/")[0].toLowerCase().replace(/:22$/, "");
  if (/cluster\d+\.hosting\.ovh\.(com|fr)$/.test(candidate)) candidate = candidate.replace(/ovh\.(com|fr)$/, "ovh.net");
  if (/^cluster\d+\.hosting\.ovh\.net$/.test(candidate)) candidate = `ftp.${candidate}`;
  return candidate;
}

function analyzeDeploy(raw, siteUrl) {
  const host = String(raw.host || "").trim();
  const user = String(raw.user || "").trim();
  const remoteDir = String(raw.remoteDir ?? "www").trim().replace(/\\/g, "/");
  const config = { host, user, remoteDir, tls: raw.tls !== false };
  const issues = [];
  const siteHost = String(siteUrl || "").replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase();

  if (!host) {
    issues.push(issue("host", `Le serveur FTP est vide. Chez OVH, il ressemble à ${OVH_EXAMPLE} (onglet FTP-SSH de l'hébergement).`));
  } else if (/\s/.test(host)) {
    issues.push(issue("host", "Le serveur FTP contient un espace.", host.replace(/\s+/g, "")));
  } else if (/^[a-z]+:\/\//i.test(host) || host.includes("/")) {
    const [bare, ...rest] = host.replace(/^[a-z]+:\/\//i, "").split("/");
    const path = rest.filter(Boolean).join("/");
    issues.push(issue("host", `Le serveur FTP doit être un nom seul, sans « ftp:// » ni chemin. Le nom à utiliser est ${bare}.${path ? ` Le chemin « ${path} » va dans « Dossier du site ».` : ""}`, bare));
  } else {
    const lower = host.toLowerCase();
    const bare = lower.replace(/:\d+$/, "");
    const port = (lower.match(/:(\d+)$/) || [])[1];
    if (port === "22") {
      issues.push(issue("host", "Le port 22 sert au SFTP, que l'outil n'utilise pas. Retirez « :22 » pour utiliser le FTP chiffré standard.", bare));
    } else if (siteHost && (bare === siteHost || bare === siteHost.replace(/^www\./, ""))) {
      issues.push(issue("host", `« ${host} » est l'adresse du site, pas celle du serveur FTP. Chez OVH, le serveur FTP ressemble à ${OVH_EXAMPLE}.`));
    } else if (/ovh\.(com|fr)$/.test(bare) && bare.includes("cluster")) {
      issues.push(issue("host", "Les serveurs FTP OVH se terminent par « .ovh.net ».", bare.replace(/ovh\.(com|fr)$/, "ovh.net")));
    } else if (/^cluster\d+\.hosting\.ovh\.net$/.test(bare)) {
      issues.push(issue("host", "Il manque « ftp. » au début du serveur OVH.", `ftp.${bare}`));
    } else if (bare.includes("ovh") && !OVH_FTP_HOST.test(lower)) {
      issues.push(issue("host", `Ce nom ne ressemble pas à un serveur FTP OVH (${OVH_EXAMPLE}, avec 3 chiffres après « cluster »). Recopiez-le depuis l'onglet FTP-SSH.`));
    }
  }

  if (!user) {
    issues.push(issue("user", "L'identifiant FTP est vide. Il est affiché dans l'onglet FTP-SSH de l'hébergement OVH."));
  } else if (/\s/.test(user)) {
    issues.push(issue("user", "L'identifiant FTP contient un espace.", user.replace(/\s+/g, "")));
  } else if (user.includes("@")) {
    issues.push(issue("user", "L'identifiant FTP n'est pas une adresse e-mail. Chez OVH, c'est un nom court, souvent le début du nom du site (par exemple « tospitim »), visible dans l'onglet FTP-SSH."));
  } else if (/^[a-z]{2}\d+-ovh$/i.test(user)) {
    issues.push(issue("user", "« " + user + " » est votre identifiant client OVH, pas l'identifiant FTP. Le bon identifiant est dans l'onglet FTP-SSH de l'hébergement."));
  }

  const bestHost = suggestHost(host);
  if (host && bestHost !== host && OVH_FTP_HOST.test(bestHost)) {
    issues.filter((item) => item.field === "host").forEach((item) => (item.fix = bestHost));
  }

  if (/^\/?(public_html|htdocs|html)\/?$/i.test(remoteDir) && OVH_FTP_HOST.test(host)) {
    issues.push(issue("remoteDir", "Chez OVH, le dossier du site s'appelle en général « www ».", "www"));
  } else if (/\s/.test(remoteDir)) {
    issues.push(issue("remoteDir", "Le dossier du site contient un espace. Vérifiez le nom dans l'onglet Multisite."));
  }

  return { config, issues };
}

function probePort(host, port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port, timeout: 8000 });
    const finish = (result) => {
      socket.destroy();
      resolve(result);
    };
    socket.once("connect", () => finish("open"));
    socket.once("timeout", () => finish("timeout"));
    socket.once("error", (error) => finish(error.code || "error"));
  });
}

async function probeServer(config) {
  const [hostname, port = "21"] = config.host.split(":");
  try {
    await dns.lookup(hostname);
  } catch {
    return [issue("host", `Le serveur « ${hostname} » n'existe pas. Vérifiez l'orthographe en le recopiant depuis l'onglet FTP-SSH d'OVH. Vérifiez aussi votre connexion Internet.`)];
  }
  const state = await probePort(hostname, Number(port));
  if (state === "open") return [];
  if (state === "timeout") return [issue("host", `Le serveur « ${hostname} » ne répond pas sur le port ${port}. Un pare-feu (réseau d'entreprise, Wi-Fi public) bloque peut-être le FTP : essayez depuis une autre connexion.`)];
  return [issue("host", `Le serveur « ${hostname} » refuse la connexion sur le port ${port}. Ce n'est probablement pas un serveur FTP.`)];
}

function loginAdvice(config, code) {
  const advice = {
    6: [issue("host", "Serveur FTP introuvable. Vérifiez l'adresse du serveur.")],
    7: [issue("host", "Connexion au serveur FTP impossible. Vérifiez l'adresse et votre connexion Internet.")],
    9: [issue("remoteDir", `Le dossier « ${config.remoteDir} » n'est pas accessible avec cet identifiant. Chez OVH, utilisez « www », ou laissez vide si l'identifiant FTP ouvre déjà le dossier du site.`)],
    28: [issue("host", "Le serveur FTP ne répond pas (délai dépassé). Réessayez dans quelques minutes, ou depuis une autre connexion Internet.")],
    35: [issue("tls", "La connexion chiffrée a échoué. Réessayez. Si l'erreur persiste, décochez « Connexion chiffrée ».")],
    64: [issue("tls", "Ce serveur n'accepte pas la connexion chiffrée. Décochez « Connexion chiffrée » pour publier.")],
    67: [
      issue("user", `Identifiant ou mot de passe refusé pour « ${config.user} ». Vérifiez l'identifiant dans l'onglet FTP-SSH d'OVH (majuscules et minuscules comptent).`),
      issue("password", "Si l'identifiant est bon, changez le mot de passe dans l'onglet FTP-SSH (bouton « Modifier le mot de passe »), attendez 5 minutes, puis réessayez. Après plusieurs échecs, OVH peut bloquer les essais pendant quelques minutes."),
    ],
  };
  return advice[code] || [issue("host", `La connexion FTP a échoué (erreur curl ${code}).`)];
}

async function checkLogin(config, password) {
  const lines = connectionLines(config, password, false);
  lines.push(`url = ${curlQuote(`ftp://${config.host}/`)}`, "list-only", "max-time = 30");
  const result = await runCurl(lines.join("\n") + "\n", () => {});
  return result.code === 0 ? [] : loginAdvice(config, result.code);
}

async function checkRemoteDir(config, password) {
  const dir = config.remoteDir.replace(/^\/+|\/+$/g, "");
  if (!dir) return [];
  const lines = connectionLines(config, password, false);
  lines.push(`url = ${curlQuote(remoteUrl(config, ""))}`, "list-only", "max-time = 30");
  const result = await runCurl(lines.join("\n") + "\n", () => {});
  if (result.code === 0) return [];
  return [issue("remoteDir", `Le dossier « ${dir} » n'existe pas sur le serveur. Il serait créé à la publication, mais le site ne s'afficherait pas s'il ne correspond pas au dossier configuré dans l'onglet Multisite d'OVH (en général « www »).`)];
}

async function diagnose(raw, password, siteUrl) {
  const { config, issues } = analyzeDeploy(raw, siteUrl);
  if (issues.length) return { config, issues, stage: "settings" };
  const network = await probeServer(config);
  if (network.length) return { config, issues: network, stage: "network" };
  if (!password) return { config, issues: [], stage: "network" };
  const login = await checkLogin(config, password);
  if (login.length) return { config, issues: login, stage: "login" };
  return { config, issues: await checkRemoteDir(config, password), stage: "done" };
}

async function upload(config, password, force, emit) {

  const files = listFiles(DIST);
  const hashes = Object.fromEntries(files.map((file) => [file, hashFile(path.join(DIST, file))]));
  const previous = readJson(MANIFEST_FILE, {});
  const sameTarget = previous.host === config.host && previous.remoteDir === config.remoteDir;
  const manifest = { host: config.host, remoteDir: config.remoteDir, files: !force && sameTarget ? previous.files || {} : {} };
  const saveManifest = () => writeJson(MANIFEST_FILE, manifest);

  const isPage = (file) => file.endsWith(".html");
  const changed = files
    .filter((file) => manifest.files[file] !== hashes[file])
    .sort((a, b) => Number(isPage(a)) - Number(isPage(b)) || Number(a.endsWith("index.html")) - Number(b.endsWith("index.html")));
  const removed = Object.keys(manifest.files).filter((file) => !(file in hashes));

  emit({ type: "plan", upload: changed.length, remove: removed.length });
  if (!changed.length && !removed.length) return { uploaded: 0, removed: 0, failed: [] };

  const byUrl = new Map(changed.map((file) => [remoteUrl(config, file), file]));
  const failed = [];
  let uploaded = 0;

  if (changed.length) {
    const lines = connectionLines(config, password);
    lines.push(`write-out = "%{url_effective}\\t%{response_code}\\n"`, "fail-early");
    for (const file of changed) {
      lines.push(`upload-file = ${curlQuote(path.join(DIST, ...file.split("/")))}`);
      lines.push(`url = ${curlQuote(remoteUrl(config, file))}`);
    }
    const result = await runCurl(lines.join("\n") + "\n", (line) => {
      const [url, status] = line.split("\t");
      const file = byUrl.get(url);
      if (!file) return;
      if (status === "226" || status === "250") {
        manifest.files[file] = hashes[file];
        saveManifest();
        uploaded += 1;
        emit({ type: "file", file, done: uploaded, total: changed.length });
      } else {
        failed.push(file);
        emit({ type: "error", file, status });
      }
    });
    if (result.code !== 0) emit({ type: "curl", message: CURL_ERRORS[result.code] || result.stderr });
  }

  const notReported = changed.filter((file) => manifest.files[file] !== hashes[file] && !failed.includes(file));
  failed.push(...notReported);

  let deleted = 0;
  if (removed.length && !failed.length) {
    const dir = config.remoteDir.replace(/^\/+|\/+$/g, "");
    const lines = connectionLines(config, password);
    lines.push(`url = ${curlQuote(`ftp://${config.host}/`)}`, "list-only");
    for (const file of removed) lines.push(`quote = ${curlQuote(`*DELE ${dir ? `${dir}/` : ""}${file}`)}`);
    const result = await runCurl(lines.join("\n") + "\n", () => {});
    if (result.code === 0) {
      for (const file of removed) delete manifest.files[file];
      saveManifest();
      deleted = removed.length;
      emit({ type: "removed", count: deleted });
    } else {
      emit({ type: "curl", message: result.stderr || "La suppression des anciens fichiers a échoué." });
    }
  }

  return { uploaded, removed: deleted, failed };
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
      checks: checklist(data, deploy),
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
    if (pathname === "/") return serveFile(response, ADMIN_PAGE);
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
