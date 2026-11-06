const fs = require("fs");
const path = require("path");

const DEPLOY_FILE = path.join(__dirname, "deploy.config.json");
const MANIFEST_FILE = path.join(__dirname, ".deploy-manifest.json");

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

module.exports = { readJson, writeJson, readDeployConfig, DEPLOY_FILE, MANIFEST_FILE };
