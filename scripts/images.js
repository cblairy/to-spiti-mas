#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const IMG = path.join(__dirname, "..", "site", "assets", "img");
const VARIANTS = path.join(IMG, "variants");
const MANIFEST = path.join(VARIANTS, "manifest.json");
const PHOTO_WIDTHS = [480, 800, 1200, 1800];
const SMALL_IMAGES = { "logo-tospitimas.png": [160, 270], "olive-branch.png": [160, 300], "olive-branch-white.png": [160, 300] };
const QUALITY = 78;

function imageSize(file) {
  const data = fs.readFileSync(file);
  if (data.readUInt32BE(0) === 0x89504e47) return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
  let offset = 2;
  while (offset < data.length) {
    const marker = data.readUInt16BE(offset);
    const length = data.readUInt16BE(offset + 2);
    if (marker >= 0xffc0 && marker <= 0xffcf && ![0xffc4, 0xffc8, 0xffcc].includes(marker)) {
      return { width: data.readUInt16BE(offset + 7), height: data.readUInt16BE(offset + 5) };
    }
    offset += 2 + length;
  }
  throw new Error(`Dimensions illisibles : ${path.basename(file)}`);
}

function cwebpAvailable() {
  try {
    execFileSync("cwebp", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function isFresh(source, target) {
  return fs.existsSync(target) && fs.statSync(target).mtimeMs >= fs.statSync(source).mtimeMs;
}

function encode(source, target, width, alpha) {
  const args = ["-quiet", "-q", String(QUALITY), "-m", "6", "-metadata", "none", "-resize", String(width), "0"];
  if (!alpha) args.push("-sharp_yuv");
  execFileSync("cwebp", [...args, source, "-o", target]);
}

function run() {
  if (!cwebpAvailable()) {
    console.error("cwebp est introuvable. Installez-le (Mac : brew install webp ; Windows et Linux : https://developers.google.com/speed/webp/download), puis relancez.");
    process.exit(1);
  }
  fs.mkdirSync(VARIANTS, { recursive: true });
  const manifest = {};
  let created = 0;
  const sources = fs.readdirSync(IMG).filter((name) => /\.(jpe?g|png)$/i.test(name) && name !== "favicon.png");

  for (const name of sources) {
    const source = path.join(IMG, name);
    const { width, height } = imageSize(source);
    const base = path.parse(name).name;
    const alpha = name.endsWith(".png");
    const targets = (SMALL_IMAGES[name] || PHOTO_WIDTHS).filter((w) => w < width);
    targets.push(Math.min(width, Math.max(...(SMALL_IMAGES[name] || PHOTO_WIDTHS))));
    const widths = [...new Set(targets)].sort((a, b) => a - b);

    for (const w of widths) {
      const target = path.join(VARIANTS, `${base}-${w}.webp`);
      if (isFresh(source, target)) continue;
      encode(source, target, w, alpha);
      created += 1;
    }
    manifest[name] = { width, height, widths };
  }

  for (const file of fs.readdirSync(VARIANTS)) {
    const base = file.replace(/-\d+\.webp$/, "");
    if (file.endsWith(".webp") && !sources.some((name) => path.parse(name).name === base)) fs.rmSync(path.join(VARIANTS, file));
  }

  fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + "\n");
  const total = fs.readdirSync(VARIANTS).filter((f) => f.endsWith(".webp")).reduce((sum, f) => sum + fs.statSync(path.join(VARIANTS, f)).size, 0);
  console.log(`✓ ${sources.length} images, ${created} version(s) WebP créée(s), ${(total / 1024 / 1024).toFixed(1)} Mo de versions au total`);
}

run();
