const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const dns = require("dns").promises;
const net = require("net");
const { spawn } = require("child_process");
const { readJson, writeJson, MANIFEST_FILE } = require("./storage");

const DIST = path.join(__dirname, "..", "dist");

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

module.exports = { analyzeDeploy, diagnose, upload };
