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

function emptyFields(data) {
  return FIELDS.filter((field) => getPath(data, field.path) == null).map((field) => field.path);
}

function checklist(data, deploy, buildProblems) {
  const empty = emptyFields(data);
  const today = new Date().toISOString().slice(0, 10);
  const close = data.booking?.close;
  const translationProblems = buildProblems.filter((problem) => problem.startsWith("lang/"));
  return [
    { ok: empty.length === 0, label: "Toutes les valeurs sont remplies", detail: empty.length ? `${empty.length} champ(s) vide(s), en rose ci-dessous.` : "" },
    { ok: Boolean(data.form?.web3formsKey), label: "Clé Web3Forms renseignée", detail: data.form?.web3formsKey ? "" : "Sans elle, les demandes de réservation n'arrivent nulle part." },
    { ok: Boolean(close && close >= today), label: "Période de location à venir", detail: close && close < today ? "La date de fermeture est passée : le formulaire refusera toutes les dates." : "" },
    { ok: translationProblems.length === 0, label: "Traductions complètes", detail: translationProblems.join(" ; ") },
    { ok: Boolean(deploy.host && deploy.user), label: "Réglages FTP OVH renseignés", detail: deploy.host ? "" : "Voir la section Hébergement OVH." },
    { ok: Boolean(data.site?.forceHttps), label: "HTTPS forcé", detail: data.site?.forceHttps ? "" : "Désactivé : les visiteurs peuvent arriver sur l'adresse non sécurisée.", optional: true },
  ];
}

module.exports = { FIELDS, getPath, setPath, normalize, emptyFields, checklist };
