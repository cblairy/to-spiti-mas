#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const DEFAULT_SITE_URL = "https://www.tospitimas.fr";
let siteUrl = DEFAULT_SITE_URL;
const LANGUAGES = [
  { code: "fr", label: "Français", flag: "🇫🇷", locale: "fr-FR" },
  { code: "en", label: "English", flag: "🇬🇧", locale: "en-GB" },
  { code: "es", label: "Español", flag: "🇪🇸", locale: "es-ES" },
  { code: "it", label: "Italiano", flag: "🇮🇹", locale: "it-IT" },
  { code: "el", label: "Ελληνικά", flag: "🇬🇷", locale: "el-GR" },
];
const SOURCE_LANG = "fr";

const ROOT = __dirname;
const SRC = path.join(ROOT, "src");
const DIST = path.join(ROOT, "dist");
const LANG_DIR = path.join(ROOT, "lang");
const DATA_FILE = path.join(ROOT, "data", "infos.json");

const TEXT_PATTERN = /<([a-z][a-z0-9]*)\b([^>]*?)\sdata-i18n="([^"]+)"([^>]*)>([\s\S]*?)<\/\1>/g;
const ATTR_PATTERN = /\sdata-i18n-([a-z-]+)="([^"]+)"/g;
const DATA_PATTERN = /{{(price|percent|date|value|attr):([\w.]+)}}/g;
const MISSING_VALUE = '<span class="todo">[…]</span>';

const problems = [];

function readPages() {
  return fs
    .readdirSync(SRC)
    .filter((name) => name.endsWith(".html"))
    .map((name) => ({ name, html: fs.readFileSync(path.join(SRC, name), "utf8") }));
}

function readPartials() {
  const dir = path.join(SRC, "partials");
  return Object.fromEntries(
    fs.readdirSync(dir).map((name) => [path.basename(name, ".html"), fs.readFileSync(path.join(dir, name), "utf8")])
  );
}

function includePartials(html, partials) {
  return html.replace(/<!--\s*@include (\w+)\s*-->/g, (_, name) => {
    if (!partials[name]) throw new Error(`Partial inconnu : ${name}`);
    return partials[name];
  });
}

function extractSourceStrings(html, pageName, strings) {
  for (const [, tag, , key, , content] of html.matchAll(TEXT_PATTERN)) {
    if (new RegExp(`<${tag}\\b`).test(content)) {
      problems.push(`${pageName}: data-i18n="${key}" contient une balise <${tag}> imbriquée`);
    }
    registerString(strings, key, content.trim(), pageName);
  }
  for (const tag of html.match(/<[a-z][^>]*>/g) || []) {
    for (const [, attr, key] of tag.matchAll(ATTR_PATTERN)) {
      const value = tag.match(new RegExp(`\\s${attr}="([^"]*)"`));
      if (!value) {
        problems.push(`${pageName}: data-i18n-${attr}="${key}" sans attribut ${attr}`);
        continue;
      }
      registerString(strings, key, value[1], pageName);
    }
  }
}

function registerString(strings, key, value, pageName) {
  if (key in strings && strings[key] !== value) {
    problems.push(`${pageName}: la clé "${key}" a deux textes différents`);
  }
  strings[key] = value;
}

function loadTranslations(code) {
  const file = path.join(LANG_DIR, `${code}.json`);
  if (!fs.existsSync(file)) return {};
  try {
    return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
  } catch (error) {
    throw new Error(`lang/${code}.json n'est pas un JSON valide : ${error.message}`);
  }
}

function translate(html, dictionary, fallback) {
  const lookup = (key) => dictionary[key] ?? fallback[key];
  const withText = html.replace(TEXT_PATTERN, (match, tag, before, key, after) => {
    return `<${tag}${before}${after}>${lookup(key)}</${tag}>`;
  });
  return withText.replace(/<[a-z][^>]*>/g, (tag) => {
    let result = tag;
    for (const [whole, attr, key] of tag.matchAll(ATTR_PATTERN)) {
      result = result
        .replace(whole, "")
        .replace(new RegExp(`(\\s${attr}=")[^"]*(")`), (_, open, close) => `${open}${escapeAttribute(lookup(key))}${close}`);
    }
    return result;
  });
}

function loadData() {
  if (!fs.existsSync(DATA_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8").replace(/^\uFEFF/, ""));
  } catch (error) {
    throw new Error(`data/infos.json n'est pas un JSON valide : ${error.message}`);
  }
}

function lookupPath(data, dottedPath) {
  return dottedPath.split(".").reduce((node, key) => (node == null ? undefined : node[key]), data);
}

function formatValue(kind, value, locale) {
  if (kind === "price") {
    return new Intl.NumberFormat(locale, { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(value);
  }
  if (kind === "date") {
    return new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
  }
  if (kind === "percent") {
    return new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 0 }).format(value / 100);
  }
  return String(value);
}

function renderData(html, data, locale, pageName) {
  return html.replace(DATA_PATTERN, (token, kind, dottedPath) => {
    const value = lookupPath(data, dottedPath);
    if (value === undefined) problems.push(`${pageName}: ${token} ne correspond à aucune donnée de data/infos.json`);
    if (value === undefined || value === null || value === "") return kind === "attr" ? "" : MISSING_VALUE;
    const text = formatValue(kind, value, locale);
    return kind === "attr" ? escapeAttribute(text) : escapeHtml(text);
  });
}

function escapeHtml(value) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttribute(value) {
  return String(value).replace(/"/g, "&quot;");
}

function languageMenu(currentCode, pageName) {
  return LANGUAGES.map(({ code, label, flag }) => {
    const current = code === currentCode ? ' aria-current="true"' : "";
    return `<li><a href="../${code}/${pageName}" hreflang="${code}" lang="${code}"${current}><span aria-hidden="true">${flag}</span> ${label}</a></li>`;
  }).join("\n");
}

function hreflangLinks(pageName) {
  const pagePath = pageName === "index.html" ? "" : pageName;
  const links = LANGUAGES.map(({ code }) => `<link rel="alternate" hreflang="${code}" href="${siteUrl}/${code}/${pagePath}">`);
  links.push(`<link rel="alternate" hreflang="x-default" href="${siteUrl}/${SOURCE_LANG}/${pagePath}">`);
  return links.join("\n");
}

function fillPlaceholders(html, { code, flag }, pageName) {
  const pageId = path.basename(pageName, ".html");
  return html
    .replace("<!-- @hreflang -->", hreflangLinks(pageName))
    .replace("<!-- @languages -->", languageMenu(code, pageName))
    .replace(/{{lang}}/g, code)
    .replace(/{{flag}}/g, flag)
    .replace(/{{canonical}}/g, `${siteUrl}/${code}/${pageName === "index.html" ? "" : pageName}`)
    .replace(/(<a\b[^>]*\bdata-page="([\w-]+)")/g, (match, open, target) =>
      target === pageId ? `${open} aria-current="page"` : match
    );
}

function copyDirectory(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (entry.isDirectory()) copyDirectory(source, target);
    else fs.copyFileSync(source, target);
  }
}

function writeLanguageRedirect(fileName, base) {
  const codes = JSON.stringify(LANGUAGES.map(({ code }) => code));
  const links = LANGUAGES.map(({ code, label }) => `<li><a href="${base}${code}/">${label}</a></li>`).join("");
  fs.writeFileSync(
    path.join(DIST, fileName),
    `<!DOCTYPE html>
<html lang="${SOURCE_LANG}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>To Spiti Mas – Ios</title>
${hreflangLinks("index.html")}
<script>
  var codes = ${codes};
  var saved = null;
  try { saved = localStorage.getItem("lang"); } catch (e) {}
  var browser = (navigator.language || "").slice(0, 2).toLowerCase();
  var code = codes.indexOf(saved) >= 0 ? saved : codes.indexOf(browser) >= 0 ? browser : "${SOURCE_LANG}";
  location.replace("${base}" + code + "/");
</script>
</head>
<body>
<ul>${links}</ul>
</body>
</html>
`
  );
}

function apacheConfig(forceHttps) {
  const https = forceHttps
    ? `RewriteEngine On
RewriteCond %{HTTPS} off
RewriteCond %{HTTP:X-Forwarded-Proto} !https
RewriteRule ^ https://%{HTTP_HOST}%{REQUEST_URI} [L,R=301]

`
    : "";
  return `${https}ErrorDocument 404 /404.html
Options -Indexes
AddDefaultCharset UTF-8

<IfModule mod_deflate.c>
  AddOutputFilterByType DEFLATE text/html text/css text/javascript application/javascript application/json image/svg+xml
</IfModule>

<IfModule mod_expires.c>
  ExpiresActive On
  ExpiresByType text/html "access plus 0 seconds"
  ExpiresByType text/css "access plus 1 week"
  ExpiresByType text/javascript "access plus 1 week"
  ExpiresByType application/javascript "access plus 1 week"
  ExpiresByType image/jpeg "access plus 1 month"
  ExpiresByType image/png "access plus 1 month"
</IfModule>
`;
}

function build() {
  problems.length = 0;
  const partials = readPartials();
  const pages = readPages().map(({ name, html }) => ({ name, html: includePartials(html, partials) }));

  const data = loadData();
  siteUrl = String(data.site?.url || DEFAULT_SITE_URL).replace(/\/+$/, "");
  const source = {};
  for (const page of pages) extractSourceStrings(page.html, page.name, source);
  fs.writeFileSync(path.join(LANG_DIR, `${SOURCE_LANG}.json`), JSON.stringify(source, null, 2) + "\n");

  fs.rmSync(DIST, { recursive: true, force: true, maxRetries: 3 });
  copyDirectory(path.join(SRC, "assets"), path.join(DIST, "assets"));

  for (const language of LANGUAGES) {
    const dictionary = language.code === SOURCE_LANG ? source : loadTranslations(language.code);
    const missing = Object.keys(source).filter((key) => !(key in dictionary));
    const unknown = Object.keys(dictionary).filter((key) => !(key in source));
    if (missing.length) problems.push(`lang/${language.code}.json : ${missing.length} clé(s) manquante(s), texte français utilisé (${missing.slice(0, 5).join(", ")}${missing.length > 5 ? "…" : ""})`);
    const tokensOf = (text) => (String(text).match(DATA_PATTERN) || []).sort().join(" ");
    for (const key of Object.keys(source)) {
      if (key in dictionary && tokensOf(dictionary[key]) !== tokensOf(source[key])) {
        problems.push(`lang/${language.code}.json : la clé "${key}" n'a pas les mêmes repères {{…}} que le français`);
      }
    }
    if (unknown.length) problems.push(`lang/${language.code}.json : ${unknown.length} clé(s) inutilisée(s) (${unknown.slice(0, 5).join(", ")}${unknown.length > 5 ? "…" : ""})`);

    const outDir = path.join(DIST, language.code);
    fs.mkdirSync(outDir, { recursive: true });
    for (const page of pages) {
      const translated = renderData(translate(page.html, dictionary, source), data, language.locale, page.name);
      const html = fillPlaceholders(translated, language, page.name);
      fs.writeFileSync(path.join(outDir, page.name), html);
    }
  }
  writeLanguageRedirect("index.html", "");
  writeLanguageRedirect("404.html", "/");
  fs.writeFileSync(path.join(DIST, ".htaccess"), apacheConfig(Boolean(data.site?.forceHttps)));

  const keyCount = Object.keys(source).length;
  console.log(`✓ ${pages.length} pages × ${LANGUAGES.length} langues générées dans dist/ (${keyCount} textes)`);
  for (const problem of [...new Set(problems)]) console.warn(`⚠ ${problem}`);
  return { problems: [...new Set(problems)] };
}

if (require.main === module) build();

module.exports = { build, loadData, DATA_FILE };
