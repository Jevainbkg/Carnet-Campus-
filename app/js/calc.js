// Règles métier pures (sans DOM ni réseau) : testées par tests/calc.test.mjs.

/**
 * Moyenne pondérée = somme(note × coefficient) / somme(coefficients des matières notées).
 * Une matière sans note est ignorée (jamais comptée comme 0).
 * @param {{value:number, coefficient:number}[]} grades
 * @returns {number|null} null si aucune note
 */
export function weightedAverage(grades) {
  let total = 0;
  let coefs = 0;
  for (const g of grades) {
    if (g == null || g.value == null || g.coefficient == null) continue;
    total += Number(g.value) * Number(g.coefficient);
    coefs += Number(g.coefficient);
  }
  if (coefs === 0) return null;
  return Math.round((total / coefs) * 100) / 100;
}

/** Formate une moyenne ou une note pour l'affichage français. */
export function formatScore(n) {
  if (n == null) return "—";
  return Number(n).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Note sur 20 exprimée en pourcentage, ex. 18 → « 90 % ». */
export function formatPercent(n) {
  if (n == null) return "—";
  return (Number(n) * 5).toLocaleString("fr-FR", { maximumFractionDigits: 1 }) + " %";
}

/** Montant en dollars, ex. 925 → « 925,00 $ ». */
export function formatMoney(n) {
  if (n == null) return "—";
  return Number(n).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " $";
}

/** Date et heure courtes en français. */
export function formatDateTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
}

/** Statut d'un frais d'après le montant payé et le montant dû (même règle que la vue SQL fee_status). */
export function feeStatus(paid, due) {
  const p = Number(paid ?? 0);
  if (p >= Number(due)) return "paye";
  if (p > 0) return "acompte";
  return "impaye";
}

export const FEE_LABEL = { paye: "Payé", acompte: "Acompte", impaye: "Impayé" };
export const FEE_TAG = { paye: "tag--ok", acompte: "tag--warn", impaye: "tag--bad" };

/**
 * Valide une note saisie (texte du formulaire). Accepte la virgule décimale.
 * @returns {{ok:true, value:number} | {ok:false, error:string}}
 */
export function parseGrade(raw) {
  const text = String(raw ?? "").trim().replace(",", ".");
  if (text === "") return { ok: false, error: "Saisissez une note." };
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(text)) {
    return { ok: false, error: "La note doit être un nombre (2 décimales au plus)." };
  }
  const value = Number(text);
  if (value < 0 || value > 20) return { ok: false, error: "La note doit être comprise entre 0 et 20." };
  return { ok: true, value };
}

/** Valide un coefficient : entier strictement positif (1 à 100). */
export function parseCoefficient(raw) {
  const text = String(raw ?? "").trim();
  if (!/^\d+$/.test(text)) return { ok: false, error: "Le coefficient doit être un nombre entier." };
  const value = Number(text);
  if (value < 1 || value > 100) return { ok: false, error: "Le coefficient doit être compris entre 1 et 100." };
  return { ok: true, value };
}

/** Valide un montant strictement positif, 2 décimales au plus, virgule acceptée. */
export function parseAmount(raw) {
  const text = String(raw ?? "").trim().replace(/\s/g, "").replace(",", ".");
  if (text === "") return { ok: false, error: "Saisissez un montant." };
  if (!/^\d{1,8}(\.\d{1,2})?$/.test(text)) return { ok: false, error: "Montant invalide (2 décimales au plus)." };
  const value = Number(text);
  if (value <= 0) return { ok: false, error: "Le montant doit être supérieur à 0." };
  return { ok: true, value };
}

/** Valide un texte obligatoire (nom, matricule…). */
export function parseText(raw, label, max = 100) {
  const value = String(raw ?? "").trim().replace(/\s+/g, " ");
  if (value === "") return { ok: false, error: `${label} est obligatoire.` };
  if (value.length > max) return { ok: false, error: `${label} : ${max} caractères au plus.` };
  return { ok: true, value };
}

/** Valide un code d'accès étudiant : 12 caractères hexadécimaux, tirets et espaces facultatifs. */
export function parseAccessCode(raw) {
  const compact = String(raw ?? "").toUpperCase().replace(/[\s-]/g, "");
  if (compact === "") return { ok: false, error: "Saisissez le code d'accès." };
  if (!/^[0-9A-F]{12}$/.test(compact)) return { ok: false, error: "Le code comporte 12 caractères (chiffres et lettres A à F), par ex. A1B2-C3D4-E5F6." };
  return { ok: true, value: compact.replace(/(.{4})(.{4})(.{4})/, "$1-$2-$3") };
}

export const CARD_PREFIX = "carnet-campus:";

/** Contenu du QR code d'une carte : préfixe + jeton opaque (jamais le matricule). */
export function cardPayload(token) {
  return CARD_PREFIX + token;
}

/** Extrait le jeton d'un QR scanné ou d'une saisie manuelle. Renvoie null si le format est inconnu. */
export function parseCardPayload(raw) {
  const text = String(raw ?? "").trim().toLowerCase();
  const token = text.startsWith(CARD_PREFIX) ? text.slice(CARD_PREFIX.length) : text;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(token) ? token : null;
}

/** Normalise pour la recherche : minuscules, sans accents. */
export function normalize(s) {
  return String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

/** Filtre les étudiants par nom, prénom ou matricule. */
export function searchStudents(rows, query) {
  const q = normalize(query);
  if (!q) return rows;
  return rows.filter((r) => normalize(`${r.first_name} ${r.last_name} ${r.matricule}`).includes(q));
}

export const ROLE_LABEL = { admin: "Administrateur", enseignant: "Enseignant", agent: "Agent de sécurité", etudiant: "Étudiant" };

/** Traduit une erreur Supabase/Postgres/réseau en message lisible. */
export function errorMessage(err) {
  if (!err) return "Erreur inconnue.";
  const code = err.code;
  const msg = String(err.message ?? err);
  if (code === "23505") {
    if (msg.includes("matricule")) return "Ce matricule existe déjà.";
    if (msg.includes("subjects_name")) return "Cette matière existe déjà.";
    if (msg.includes("fee_types_name")) return "Ce type de frais existe déjà.";
    if (msg.includes("grades_student_subject")) return "Une note existe déjà pour cette matière.";
    return "Cet élément existe déjà.";
  }
  if (code === "23503") return "Élément utilisé ailleurs : suppression impossible.";
  if (code === "23514") return "Valeur refusée par la base (hors limites).";
  if (code === "42501") return msg && !/row-level|permission denied/i.test(msg) ? msg : "Accès refusé.";
  if (code === "P0001" || code === "P0002" || code === "22023") return msg;
  if (/Invalid login credentials/i.test(msg)) return "E-mail ou mot de passe incorrect.";
  if (/Email not confirmed/i.test(msg)) return "Confirmez votre adresse e-mail avant de vous connecter.";
  if (/User already registered/i.test(msg)) return "Un compte existe déjà avec cet e-mail.";
  if (/Password should be/i.test(msg)) return "Mot de passe trop court (6 caractères minimum).";
  if (/Failed to fetch|NetworkError|network/i.test(msg)) return "Connexion impossible. Vérifiez votre réseau puis réessayez.";
  return msg;
}
