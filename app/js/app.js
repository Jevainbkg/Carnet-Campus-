// Interface : routeur par hash et écrans. Les règles métier sont dans calc.js, la sécurité dans la base.
import * as api from "./api.js";
import {
  formatScore, formatPercent, formatMoney, formatDateTime, parseGrade, parseCoefficient, parseAmount,
  parseText, parseAccessCode, parseCardPayload, cardPayload, searchStudents, errorMessage,
  FEE_LABEL, FEE_TAG, ROLE_LABEL,
} from "./calc.js";
import { qrSvg, startScanner } from "./qr.js";

const view = document.getElementById("view");
const nav = document.getElementById("nav");
const account = document.getElementById("account");
const toastEl = document.getElementById("toast");

let session = null;
let role = null; // "admin" | "enseignant" | "agent" | "etudiant" | null (compte en attente)
let stopScan = null; // arrêt de la caméra quand on quitte l'écran de contrôle
const ui = { query: "", subjectId: "" };

// ---------- Utilitaires ----------
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fullName = (s) => `${s.first_name} ${s.last_name}`;

function render(html, title) {
  view.innerHTML = html;
  document.title = `${title} — Carnet Campus`;
}

function loading(label = "Chargement…") {
  view.innerHTML = `<p class="state state--loading" role="status">${esc(label)}</p>`;
}

function showError(err, retry) {
  view.innerHTML = `
    <div class="state state--error" role="alert">
      <p><strong>Impossible de charger les données.</strong></p>
      <p>${esc(errorMessage(err))}</p>
      <button type="button" class="btn" id="retry">Réessayer</button>
    </div>`;
  view.querySelector("#retry").addEventListener("click", retry);
}

let toastTimer;
function toast(message, kind = "ok") {
  toastEl.textContent = message;
  toastEl.dataset.kind = kind;
  toastEl.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("is-visible"), 3500);
}

async function busy(button, task) {
  if (button.disabled) return;
  const label = button.textContent;
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  button.textContent = "…";
  try {
    return await task();
  } finally {
    button.disabled = false;
    button.removeAttribute("aria-busy");
    button.textContent = label;
  }
}

function fieldError(form, name, message) {
  const input = form.elements[name];
  const slot = form.querySelector(`[data-error-for="${name}"]`);
  if (input) input.setAttribute("aria-invalid", message ? "true" : "false");
  if (slot) slot.textContent = message ?? "";
}

function clearErrors(form) {
  form.querySelectorAll("[data-error-for]").forEach((el) => (el.textContent = ""));
  form.querySelectorAll("[aria-invalid]").forEach((el) => el.setAttribute("aria-invalid", "false"));
  const g = form.querySelector(".form-error");
  if (g) g.textContent = "";
}

function formError(form, err) {
  const g = form.querySelector(".form-error");
  if (g) g.textContent = errorMessage(err);
}

// Valide plusieurs champs d'un coup ; renvoie null si un champ est invalide.
function validate(form, checks) {
  const out = {};
  let ok = true;
  for (const [name, check] of Object.entries(checks)) {
    const r = check(form.elements[name].value);
    if (r.ok) out[name] = r.value;
    else { fieldError(form, name, r.error); ok = false; }
  }
  return ok ? out : null;
}

const field = (name, label, attrs = "") => `
  <div class="field">
    <label for="f-${name}">${label}</label>
    <input id="f-${name}" name="${name}" ${attrs}>
    <p class="field__error" data-error-for="${name}"></p>
  </div>`;

const feeTag = (status) => `<span class="tag ${FEE_TAG[status]}">${FEE_LABEL[status]}</span>`;

// ---------- Routeur ----------
let navSeq = 0;

const routes = {
  connexion: viewLogin,
  accueil: viewPending,
  carte: viewCard,
  releve: viewMyTranscript,
  controle: viewControl,
  alertes: viewAlerts,
  matieres: viewSubjects,
  saisie: viewGradeEntry,
  etudiants: viewStudents,
  etudiant: viewStudent,
  membres: viewMembers,
  frais: viewFeeTypes,
  journal: viewJournal,
};

const NAV = {
  etudiant: [["carte", "Ma carte"], ["releve", "Mes notes"]],
  agent: [["controle", "Contrôle"], ["alertes", "Alertes"]],
  enseignant: [["matieres", "Mes matières"], ["saisie", "Saisie des notes"]],
  admin: [["etudiants", "Étudiants"], ["membres", "Comptes"], ["frais", "Frais"], ["journal", "Journal"], ["alertes", "Alertes"]],
  null: [["accueil", "Accueil"]],
};
const ALLOWED = {
  etudiant: ["carte", "releve"],
  agent: ["controle", "alertes"],
  enseignant: ["matieres", "saisie"],
  admin: ["etudiants", "etudiant", "membres", "frais", "journal", "alertes"],
  null: ["accueil"],
};
const home = () => `#/${ALLOWED[role][0]}`;

function currentRoute() {
  const [, name = "", param] = location.hash.split("/");
  return { name: routes[name] ? name : "", param };
}

async function refreshRole() {
  role = session ? await api.myRole() : null;
  nav.innerHTML = NAV[role].map(([r, label]) => `<a href="#/${r}" data-route="${r}">${label}</a>`).join("");
}

async function router() {
  const seq = ++navSeq;
  if (stopScan) { const s = stopScan; stopScan = null; await s(); }
  let { name, param } = currentRoute();
  if (!session) {
    if (name !== "connexion") return void location.replace("#/connexion");
  } else if (name === "connexion" || !name) {
    return void location.replace(home());
  } else if (!ALLOWED[role].includes(name)) {
    return void location.replace(home());
  }
  nav.hidden = !session;
  account.hidden = !session;
  nav.querySelectorAll("a").forEach((a) => {
    const active = a.dataset.route === name || (name === "etudiant" && a.dataset.route === "etudiants");
    if (active) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  });
  view.focus({ preventScroll: true });
  await routes[name]({ param, isCurrent: () => seq === navSeq });
}

// ---------- Connexion ----------
function viewLogin() {
  render(`
    <section class="auth">
      <h1>Carnet Campus</h1>
      <p class="muted">Notes, frais et contrôle d'accès d'un établissement, dans une seule application.</p>
      <div class="tabs" role="tablist">
        <button type="button" role="tab" id="tab-in" aria-selected="true">Connexion</button>
        <button type="button" role="tab" id="tab-up" aria-selected="false">Créer un compte</button>
      </div>
      <form class="card form" id="auth-form" novalidate>
        ${field("email", "E-mail", 'type="email" autocomplete="email" required')}
        ${field("password", "Mot de passe", 'type="password" autocomplete="current-password" minlength="6" required')}
        <p class="form-error" role="alert"></p>
        <p class="muted small" id="signup-help" hidden>Après inscription, saisissez le code d'accès donné par l'administration (étudiant) ou attendez qu'un administrateur vous attribue un rôle.</p>
        <div class="form__actions"><button type="submit" class="btn" id="auth-submit">Se connecter</button></div>
      </form>
    </section>`, "Connexion");

  const form = view.querySelector("#auth-form");
  let mode = "in";
  const setMode = (m) => {
    mode = m;
    view.querySelector("#tab-in").setAttribute("aria-selected", String(m === "in"));
    view.querySelector("#tab-up").setAttribute("aria-selected", String(m === "up"));
    view.querySelector("#auth-submit").textContent = m === "in" ? "Se connecter" : "Créer le compte";
    view.querySelector("#signup-help").hidden = m === "in";
    form.elements.password.autocomplete = m === "in" ? "current-password" : "new-password";
    clearErrors(form);
  };
  view.querySelector("#tab-in").addEventListener("click", () => setMode("in"));
  view.querySelector("#tab-up").addEventListener("click", () => setMode("up"));

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearErrors(form);
    const email = form.elements.email.value.trim();
    const password = form.elements.password.value;
    let ok = true;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { fieldError(form, "email", "Adresse e-mail invalide."); ok = false; }
    if (password.length < 6) { fieldError(form, "password", "6 caractères minimum."); ok = false; }
    if (!ok) return;
    await busy(form.querySelector("#auth-submit"), async () => {
      try {
        if (mode === "in") await api.auth.signIn(email, password);
        else {
          const res = await api.auth.signUp(email, password);
          if (!res.session) {
            setMode("in");
            form.querySelector(".form-error").textContent = "";
            toast("Compte créé : confirmez votre e-mail puis connectez-vous.");
          }
        }
      } catch (err) { formError(form, err); }
    });
  });
}

// ---------- Compte en attente ----------
function viewPending() {
  render(`
    <h1>Bienvenue</h1>
    <p class="muted">Votre compte n'a pas encore de rôle.</p>
    <div class="grid-2">
      <form class="card form" id="join-form" novalidate>
        <h2 class="form__title">Je suis étudiant</h2>
        <p class="muted small">Saisissez le code d'accès remis par l'administration (format XXXX-XXXX-XXXX).</p>
        ${field("code", "Code d'accès", 'class="code-input" autocomplete="off" placeholder="A1B2-C3D4-E5F6"')}
        <p class="form-error" role="alert"></p>
        <div class="form__actions"><button type="submit" class="btn" id="join-submit">Valider le code</button></div>
      </form>
      <section class="card section">
        <h2>Personnel</h2>
        <p class="muted">Enseignants et agents : un administrateur doit vous attribuer un rôle. Communiquez-lui votre e-mail : <strong>${esc(session.user.email)}</strong>.</p>
        <p class="muted small">Première installation ? Le tout premier compte peut devenir administrateur.</p>
        <button type="button" class="btn btn--ghost" id="first-admin">Devenir administrateur</button>
      </section>
    </div>`, "Accueil");

  const form = view.querySelector("#join-form");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearErrors(form);
    const v = validate(form, { code: parseAccessCode });
    if (!v) return;
    await busy(form.querySelector("#join-submit"), async () => {
      try {
        await api.claimStudent(v.code);
        toast("Fiche rattachée à votre compte.");
        await refreshRole();
        location.hash = home();
      } catch (err) { formError(form, err); }
    });
  });
  view.querySelector("#first-admin").addEventListener("click", (e) => busy(e.currentTarget, async () => {
    try {
      if (await api.claimFirstAdmin()) {
        toast("Vous êtes administrateur.");
        await refreshRole();
        location.hash = home();
      } else toast("Un administrateur existe déjà : demandez-lui un rôle.", "error");
    } catch (err) { toast(errorMessage(err), "error"); }
  }));
}

// ---------- Étudiant : carte et frais ----------
function feesTable(fees) {
  if (fees.length === 0) return `<p class="state">Aucun type de frais défini.</p>`;
  return `<div class="table-wrap"><table class="table">
    <caption class="sr-only">État des frais</caption>
    <thead><tr><th scope="col">Frais</th><th scope="col" class="num">Dû</th><th scope="col" class="num">Payé</th><th scope="col">Statut</th></tr></thead>
    <tbody>${fees.map((f) => `
      <tr>
        <th scope="row">${esc(f.name)}${f.required_for_access ? "" : ` <span class="tag">facultatif pour l'accès</span>`}</th>
        <td data-label="Dû" class="num">${formatMoney(f.amount_due)}</td>
        <td data-label="Payé" class="num">${formatMoney(f.paid)}</td>
        <td data-label="Statut">${feeTag(f.status)}</td>
      </tr>`).join("")}</tbody>
  </table></div>`;
}

async function viewCard({ isCurrent }) {
  loading();
  try {
    const me = await api.myStudent(session.user.id);
    if (!isCurrent()) return;
    if (!me) return void location.replace("#/accueil");
    const [fees, svg] = await Promise.all([api.feeStatus(me.id), qrSvg(cardPayload(me.card_token)).catch(() => null)]);
    if (!isCurrent()) return;
    render(`
      <h1>Ma carte</h1>
      <div class="grid-2">
        <article class="card id-card" aria-label="Carte étudiant">
          <p class="muted small">Carte étudiant · Carnet Campus</p>
          <p class="id-card__name">${esc(fullName(me))}</p>
          <p><span class="code">${esc(me.matricule)}</span> · ${esc(me.level || "—")}</p>
          <div class="id-card__qr" id="qr">${svg ?? `<p class="muted small">QR indisponible (réseau).</p>`}</div>
          <p class="muted small">Code de secours (saisie manuelle) :<br><span class="code small" id="card-token">${esc(me.card_token)}</span></p>
          <p class="muted small">Présentez ce QR code à l'agent à l'entrée. En cas de perte, demandez à l'administration de renouveler la carte.</p>
        </article>
        <section class="card section">
          <h2>Mes frais</h2>
          ${feesTable(fees)}
        </section>
      </div>`, "Ma carte");
  } catch (err) {
    if (isCurrent()) showError(err, router);
  }
}

// ---------- Relevé de notes (partagé admin / étudiant) ----------
function transcriptHtml(student, { lines, average }) {
  const graded = lines.filter((l) => l.value != null);
  const totalCoef = graded.reduce((s, l) => s + l.coefficient, 0);
  const cls = average == null ? "score--none" : average >= 10 ? "score--pass" : "score--fail";
  return `
    <article class="card report" aria-labelledby="t-${student.id}">
      <header class="report__head">
        <div>
          <h2 class="report__title" id="t-${student.id}">${esc(fullName(student))}</h2>
          <p class="muted">Matricule ${esc(student.matricule)} · relevé de notes</p>
        </div>
        <div class="report__avg">
          <span class="report__avg-label">Moyenne pondérée</span>
          <span class="report__avg-value score ${cls}" id="average">${formatScore(average)}</span>
          <span class="muted small">${graded.length} matière${graded.length > 1 ? "s" : ""} notée${graded.length > 1 ? "s" : ""} sur ${lines.length}</span>
        </div>
      </header>
      ${lines.length === 0 ? `<p class="state">Aucune matière pour l'instant.</p>` : `
      <div class="table-wrap"><table class="table">
        <caption class="sr-only">Relevé de notes</caption>
        <thead><tr><th scope="col">Matière</th><th scope="col" class="num">Coef.</th><th scope="col" class="num">Note /20</th><th scope="col" class="num">Pourcentage</th></tr></thead>
        <tbody>${lines.map((l) => `
          <tr>
            <th scope="row">${esc(l.name)}</th>
            <td data-label="Coef." class="num">${l.coefficient}</td>
            <td data-label="Note /20" class="num">${l.value == null ? `<span class="tag">non notée</span>` : formatScore(l.value)}</td>
            <td data-label="Pourcentage" class="num">${formatPercent(l.value)}</td>
          </tr>`).join("")}</tbody>
        <tfoot><tr><th scope="row">Total (matières notées)</th><td class="num">${totalCoef}</td><td></td><td class="num">${formatPercent(average)}</td></tr></tfoot>
      </table></div>
      <p class="muted small">Moyenne = somme(note × coefficient) ÷ somme des coefficients des matières notées. Une matière non notée ne compte pas comme 0.</p>`}
      <div class="report__actions no-print"><button type="button" class="btn btn--ghost" data-print>Imprimer / PDF</button></div>
    </article>`;
}

const bindPrint = () => view.querySelectorAll("[data-print]").forEach((b) => b.addEventListener("click", () => window.print()));

async function viewMyTranscript({ isCurrent }) {
  loading();
  try {
    const me = await api.myStudent(session.user.id);
    if (!isCurrent()) return;
    if (!me) return void location.replace("#/accueil");
    const t = await api.transcript(me.id);
    if (!isCurrent()) return;
    render(`<h1>Mes notes</h1><p class="muted">Consultation seule. Pour toute correction, adressez-vous à votre enseignant.</p>${transcriptHtml(me, t)}`, "Mes notes");
    bindPrint();
  } catch (err) {
    if (isCurrent()) showError(err, router);
  }
}

// ---------- Agent : contrôle d'accès ----------
async function viewControl({ isCurrent }) {
  loading();
  try {
    const [me, checks] = await Promise.all([api.myMember(session.user.id), api.listChecks(10)]);
    if (!isCurrent()) return;
    render(`
      <h1>Contrôle d'accès</h1>
      <section class="card duty">
        <p>Statut : <span class="duty__state" id="duty-state">${me.on_duty ? "En service" : "Hors service"}</span></p>
        <button type="button" class="btn ${me.on_duty ? "btn--ghost" : ""}" id="duty-toggle">${me.on_duty ? "Terminer le service" : "Prendre le service"}</button>
      </section>
      <div class="grid-2">
        <section class="card section">
          <h2>Scanner une carte</h2>
          <div class="scanner" id="scanner"><p>Caméra arrêtée.</p></div>
          <div class="row" style="margin-top: var(--space-3)">
            <button type="button" class="btn" id="scan-start" ${me.on_duty ? "" : "disabled"}>Démarrer la caméra</button>
          </div>
          <form class="form" id="manual-form" novalidate style="padding: var(--space-4) 0 0; margin: 0">
            ${field("token", "Ou saisir le code de la carte", 'autocomplete="off" class="code-input"')}
            <div class="form__actions"><button type="submit" class="btn btn--ghost" id="manual-submit" ${me.on_duty ? "" : "disabled"}>Vérifier</button></div>
          </form>
        </section>
        <section>
          <div id="verdict" aria-live="polite"><p class="state">${me.on_duty ? "En attente d'un scan." : "Prenez le service pour contrôler les cartes."}</p></div>
          <section class="card section" style="margin-top: var(--space-4)">
            <h2>Mes derniers contrôles</h2>
            <ul id="checks" class="small">${checks.map(checkLine).join("") || `<li class="muted">Aucun contrôle.</li>`}</ul>
          </section>
        </section>
      </div>`, "Contrôle");

    let onDuty = me.on_duty;
    let last = { token: "", at: 0 };
    const verdictEl = view.querySelector("#verdict");

    const check = async (raw) => {
      const token = parseCardPayload(raw);
      const now = Date.now();
      if (token && token === last.token && now - last.at < 4000) return; // même carte encore devant la caméra
      last = { token, at: now };
      if (!token) {
        verdictEl.innerHTML = verdictHtml({ allowed: false, reason: "QR code non reconnu (ce n'est pas une carte Carnet Campus)." });
        return;
      }
      try {
        const r = await api.verifyCard(token);
        if (!isCurrent()) return;
        verdictEl.innerHTML = verdictHtml(r);
        const list = await api.listChecks(10);
        if (isCurrent()) view.querySelector("#checks").innerHTML = list.map(checkLine).join("");
      } catch (err) {
        verdictEl.innerHTML = `<p class="state state--error" role="alert">${esc(errorMessage(err))}</p>`;
      }
    };

    view.querySelector("#duty-toggle").addEventListener("click", (e) => busy(e.currentTarget, async () => {
      try {
        await api.setOnDuty(!onDuty);
        toast(onDuty ? "Service terminé." : "Vous êtes en service.");
        router();
      } catch (err) { toast(errorMessage(err), "error"); }
    }));

    view.querySelector("#scan-start").addEventListener("click", (e) => busy(e.currentTarget, async () => {
      if (stopScan) { const s = stopScan; stopScan = null; await s(); view.querySelector("#scanner").innerHTML = "<p>Caméra arrêtée.</p>"; e.currentTarget.dataset.on = ""; return; }
      try {
        view.querySelector("#scanner").innerHTML = "";
        stopScan = await startScanner("scanner", check);
      } catch (err) {
        view.querySelector("#scanner").innerHTML = `<p>${esc(err?.message ?? "Caméra indisponible.")} Utilisez la saisie manuelle.</p>`;
      }
    }));

    const form = view.querySelector("#manual-form");
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      clearErrors(form);
      if (!parseCardPayload(form.elements.token.value)) return fieldError(form, "token", "Code de carte invalide.");
      last = { token: "", at: 0 };
      await busy(form.querySelector("#manual-submit"), () => check(form.elements.token.value));
    });
  } catch (err) {
    if (isCurrent()) showError(err, router);
  }
}

function verdictHtml(r) {
  const fees = (r.fees ?? []).map((f) => `<li>${esc(f.name)} : ${feeTag(f.status)} <span class="muted">${formatMoney(f.paid)} / ${formatMoney(f.due)}</span></li>`).join("");
  return `
    <div class="verdict ${r.allowed ? "verdict--ok" : "verdict--no"}" role="status" id="verdict-box">
      <p class="verdict__title">${r.allowed ? "Accès autorisé" : "Accès refusé"}</p>
      <p><strong>${esc(r.reason)}</strong></p>
      ${r.matricule ? `<p>${esc(r.first_name)} ${esc(r.last_name)} · <span class="code">${esc(r.matricule)}</span> · ${esc(r.level || "—")}</p>` : ""}
      ${fees ? `<ul class="small">${fees}</ul>` : ""}
    </div>`;
}

const checkLine = (c) => `<li>${formatDateTime(c.checked_at)} · <span class="tag ${c.allowed ? "tag--ok" : "tag--bad"}">${c.allowed ? "autorisé" : "refusé"}</span> ${esc(c.reason)}</li>`;

// ---------- Alertes (agents et admin) ----------
async function viewAlerts({ isCurrent }) {
  loading();
  try {
    const alerts = await api.listAlerts();
    if (!isCurrent()) return;
    const canCreate = role === "agent";
    render(`
      <h1>Alertes</h1>
      ${canCreate ? `
      <form class="card form" id="alert-form" novalidate>
        <h2 class="form__title">Signaler un incident</h2>
        ${field("place", "Lieu", 'maxlength="100" placeholder="Portail B"')}
        ${field("description", "Description", 'maxlength="500" placeholder="Porte forcée, personne suspecte…"')}
        <p class="form-error" role="alert"></p>
        <div class="form__actions"><button type="submit" class="btn" id="alert-submit">Envoyer l'alerte</button></div>
      </form>` : ""}
      ${alerts.length === 0 ? `<p class="state">Aucune alerte.</p>` : `
      <div class="table-wrap"><table class="table">
        <caption class="sr-only">Alertes</caption>
        <thead><tr><th scope="col">Lieu</th><th scope="col">Description</th><th scope="col">Date</th><th scope="col">Statut</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead>
        <tbody>${alerts.map((a) => `
          <tr>
            <th scope="row">${esc(a.place)}</th>
            <td data-label="Description">${esc(a.description)}</td>
            <td data-label="Date">${formatDateTime(a.created_at)}</td>
            <td data-label="Statut">${a.resolved_at ? `<span class="tag tag--ok">Résolue</span>` : `<span class="tag tag--bad">Ouverte</span>`}</td>
            <td class="actions">${!a.resolved_at && (role === "admin" || a.agent_id === session.user.id) ? `<button type="button" class="btn btn--ghost btn--sm" data-resolve="${a.id}">Marquer résolue</button>` : ""}</td>
          </tr>`).join("")}</tbody>
      </table></div>`}`, "Alertes");

    view.querySelectorAll("[data-resolve]").forEach((b) => b.addEventListener("click", () => busy(b, async () => {
      try { await api.resolveAlert(b.dataset.resolve); toast("Alerte résolue."); router(); }
      catch (err) { toast(errorMessage(err), "error"); }
    })));
    const form = view.querySelector("#alert-form");
    form?.addEventListener("submit", async (e) => {
      e.preventDefault();
      clearErrors(form);
      const v = validate(form, { place: (x) => parseText(x, "Le lieu"), description: (x) => parseText(x, "La description", 500) });
      if (!v) return;
      await busy(form.querySelector("#alert-submit"), async () => {
        try { await api.addAlert(v.place, v.description); toast("Alerte envoyée."); router(); }
        catch (err) { formError(form, err); }
      });
    });
  } catch (err) {
    if (isCurrent()) showError(err, router);
  }
}

// ---------- Enseignant : matières ----------
async function viewSubjects({ isCurrent }) {
  loading();
  try {
    const all = await api.listSubjects();
    if (!isCurrent()) return;
    const mine = all.filter((s) => s.teacher_id === session.user.id);
    render(`
      <h1>Mes matières</h1>
      <form class="card form form--inline" id="subject-form" novalidate>
        <input type="hidden" name="id">
        ${field("name", "Matière", 'maxlength="100" placeholder="Mathématiques"')}
        <div class="field field--xs">
          <label for="f-coefficient">Coef.</label>
          <input id="f-coefficient" name="coefficient" inputmode="numeric" placeholder="1">
          <p class="field__error" data-error-for="coefficient"></p>
        </div>
        <div class="form__actions">
          <button type="submit" class="btn" id="subject-submit">Ajouter</button>
          <button type="button" class="btn btn--ghost" id="subject-cancel" hidden>Annuler</button>
        </div>
        <p class="form-error" role="alert"></p>
      </form>
      ${mine.length === 0 ? `<p class="state">Aucune matière : ajoutez la première ci-dessus.</p>` : `
      <div class="table-wrap"><table class="table">
        <caption class="sr-only">Mes matières</caption>
        <thead><tr><th scope="col">Matière</th><th scope="col" class="num">Coefficient</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead>
        <tbody>${mine.map((s) => `
          <tr>
            <th scope="row">${esc(s.name)}</th>
            <td data-label="Coefficient" class="num">${s.coefficient}</td>
            <td class="actions">
              <button type="button" class="btn btn--ghost btn--sm" data-edit="${s.id}">Modifier</button>
              <button type="button" class="btn btn--danger btn--sm" data-del="${s.id}">Supprimer</button>
            </td>
          </tr>`).join("")}</tbody>
      </table></div>`}`, "Mes matières");

    const form = view.querySelector("#subject-form");
    const reset = () => { form.reset(); form.elements.id.value = ""; view.querySelector("#subject-submit").textContent = "Ajouter"; view.querySelector("#subject-cancel").hidden = true; clearErrors(form); };
    view.querySelector("#subject-cancel").addEventListener("click", reset);
    view.querySelectorAll("[data-edit]").forEach((b) => b.addEventListener("click", () => {
      const s = mine.find((x) => x.id === b.dataset.edit);
      form.elements.id.value = s.id; form.elements.name.value = s.name; form.elements.coefficient.value = s.coefficient;
      view.querySelector("#subject-submit").textContent = "Enregistrer"; view.querySelector("#subject-cancel").hidden = false;
      form.elements.name.focus();
    }));
    view.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", () => {
      const s = mine.find((x) => x.id === b.dataset.del);
      if (!confirm(`Supprimer « ${s.name} » et toutes ses notes ?`)) return;
      busy(b, async () => {
        try { await api.deleteSubject(s.id); toast("Matière supprimée."); router(); }
        catch (err) { toast(errorMessage(err), "error"); }
      });
    }));
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      clearErrors(form);
      const v = validate(form, { name: (x) => parseText(x, "Le nom"), coefficient: parseCoefficient });
      if (!v) return;
      await busy(view.querySelector("#subject-submit"), async () => {
        try { await api.saveSubject({ id: form.elements.id.value || null, ...v }); toast("Matière enregistrée."); router(); }
        catch (err) { formError(form, err); }
      });
    });
  } catch (err) {
    if (isCurrent()) showError(err, router);
  }
}

// ---------- Enseignant : saisie des notes ----------
async function viewGradeEntry({ isCurrent }) {
  loading();
  try {
    const [all, students] = await Promise.all([api.listSubjects(), api.listStudents()]);
    if (!isCurrent()) return;
    const mine = all.filter((s) => s.teacher_id === session.user.id);
    if (mine.length === 0) {
      return render(`<h1>Saisie des notes</h1><p class="state">Créez d'abord une matière dans <a href="#/matieres">Mes matières</a>.</p>`, "Saisie des notes");
    }
    if (!mine.some((s) => s.id === ui.subjectId)) ui.subjectId = mine[0].id;
    const grades = await api.gradesForSubject(ui.subjectId);
    if (!isCurrent()) return;
    const byStudent = new Map(grades.map((g) => [g.student_id, Number(g.value)]));
    render(`
      <h1>Saisie des notes</h1>
      <div class="toolbar">
        <div class="field">
          <label for="subject-select">Matière</label>
          <select id="subject-select">${mine.map((s) => `<option value="${s.id}" ${s.id === ui.subjectId ? "selected" : ""}>${esc(s.name)} (coef. ${s.coefficient})</option>`).join("")}</select>
        </div>
      </div>
      ${students.length === 0 ? `<p class="state">Aucun étudiant inscrit pour l'instant.</p>` : `
      <ul class="grade-rows">${students.map((s) => `
        <li class="card grade-row">
          <form class="grade-form" data-student="${s.id}" novalidate>
            <label class="grade-row__name" for="g-${s.id}">${esc(fullName(s))} <span class="muted small">${esc(s.matricule)}</span></label>
            <input id="g-${s.id}" name="value" inputmode="decimal" placeholder="—" value="${byStudent.has(s.id) ? formatScore(byStudent.get(s.id)) : ""}" aria-label="Note de ${esc(fullName(s))} sur 20">
            <button type="submit" class="btn btn--sm">Enregistrer</button>
            ${byStudent.has(s.id) ? `<button type="button" class="btn btn--ghost btn--sm" data-clear>Effacer</button>` : ""}
            <p class="field__error" data-error-for="value"></p>
          </form>
        </li>`).join("")}</ul>`}`, "Saisie des notes");

    view.querySelector("#subject-select").addEventListener("change", (e) => { ui.subjectId = e.target.value; router(); });
    view.querySelectorAll(".grade-form").forEach((form) => {
      const studentId = form.dataset.student;
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        clearErrors(form);
        const v = validate(form, { value: parseGrade });
        if (!v) return;
        await busy(form.querySelector('[type="submit"]'), async () => {
          try {
            await api.upsertGrade(studentId, ui.subjectId, v.value);
            toast("Note enregistrée.");
            if (!form.querySelector("[data-clear]")) router();
          } catch (err) { fieldError(form, "value", errorMessage(err)); }
        });
      });
      form.querySelector("[data-clear]")?.addEventListener("click", (e) => busy(e.currentTarget, async () => {
        try { await api.deleteGrade(studentId, ui.subjectId); toast("Note effacée."); router(); }
        catch (err) { fieldError(form, "value", errorMessage(err)); }
      }));
    });
  } catch (err) {
    if (isCurrent()) showError(err, router);
  }
}

// ---------- Admin : étudiants ----------
function accessSummary(statuses = []) {
  const required = statuses.filter((s) => s.required_for_access);
  if (required.some((s) => s.status === "impaye")) return `<span class="tag tag--bad">Accès refusé</span>`;
  if (required.some((s) => s.status === "acompte")) return `<span class="tag tag--warn">Acompte</span>`;
  return `<span class="tag tag--ok">À jour</span>`;
}

async function viewStudents({ isCurrent }) {
  loading();
  try {
    const [students, statuses] = await Promise.all([api.listStudents(), api.allFeeStatus()]);
    if (!isCurrent()) return;
    render(`
      <h1>Étudiants</h1>
      <form class="card form" id="student-form" novalidate>
        <h2 class="form__title">Inscrire un étudiant</h2>
        <div class="grid-2" style="gap: var(--space-3)">
          ${field("matricule", "Matricule", 'maxlength="30" placeholder="CC2026001"')}
          ${field("level", "Niveau", 'maxlength="50" placeholder="L2"')}
          ${field("first_name", "Prénom", 'maxlength="100"')}
          ${field("last_name", "Nom", 'maxlength="100"')}
        </div>
        <p class="form-error" role="alert"></p>
        <div class="form__actions"><button type="submit" class="btn" id="student-submit">Inscrire</button></div>
      </form>
      <div class="toolbar">
        <div class="field"><label for="search">Rechercher</label><input id="search" type="search" placeholder="Nom ou matricule" value="${esc(ui.query)}"></div>
      </div>
      <div id="student-list"></div>`, "Étudiants");

    const list = view.querySelector("#student-list");
    const draw = () => {
      const rows = searchStudents(students, ui.query);
      list.innerHTML = students.length === 0 ? `<p class="state">Aucun étudiant : inscrivez le premier ci-dessus.</p>`
        : rows.length === 0 ? `<p class="state">Aucun résultat pour « ${esc(ui.query)} ».</p>`
        : `<p class="muted small">${rows.length} étudiant${rows.length > 1 ? "s" : ""}</p>
        <div class="table-wrap"><table class="table">
          <caption class="sr-only">Liste des étudiants</caption>
          <thead><tr><th scope="col">Étudiant</th><th scope="col">Matricule</th><th scope="col">Niveau</th><th scope="col">Frais</th><th scope="col">Compte</th></tr></thead>
          <tbody>${rows.map((s) => `
            <tr>
              <th scope="row"><a href="#/etudiant/${s.id}">${esc(fullName(s))}</a></th>
              <td data-label="Matricule"><span class="code">${esc(s.matricule)}</span></td>
              <td data-label="Niveau">${esc(s.level || "—")}</td>
              <td data-label="Frais">${accessSummary(statuses.get(s.id))}</td>
              <td data-label="Compte">${s.user_id ? `<span class="tag tag--ok">rattaché</span>` : `<span class="tag">en attente</span>`}</td>
            </tr>`).join("")}</tbody>
        </table></div>`;
    };
    draw();
    view.querySelector("#search").addEventListener("input", (e) => { ui.query = e.target.value; draw(); });

    const form = view.querySelector("#student-form");
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      clearErrors(form);
      const v = validate(form, {
        matricule: (x) => parseText(x, "Le matricule", 30),
        first_name: (x) => parseText(x, "Le prénom"),
        last_name: (x) => parseText(x, "Le nom"),
        level: (x) => ({ ok: true, value: String(x).trim().slice(0, 50) }),
      });
      if (!v) return;
      await busy(form.querySelector("#student-submit"), async () => {
        try { const s = await api.saveStudent(v); toast("Étudiant inscrit."); location.hash = `#/etudiant/${s.id}`; }
        catch (err) { formError(form, err); }
      });
    });
  } catch (err) {
    if (isCurrent()) showError(err, router);
  }
}

async function viewStudent({ param, isCurrent }) {
  loading();
  try {
    const s = await api.getStudent(param);
    if (!isCurrent()) return;
    if (!s) return render(`<p class="state">Fiche introuvable. <a href="#/etudiants">Retour à la liste</a></p>`, "Étudiant");
    const [fees, payments, feeTypes, t] = await Promise.all([api.feeStatus(s.id), api.listPayments(s.id), api.listFeeTypes(), api.transcript(s.id)]);
    if (!isCurrent()) return;
    const feeName = new Map(feeTypes.map((f) => [f.id, f.name]));
    render(`
      <p class="breadcrumb"><a href="#/etudiants">← Étudiants</a></p>
      <div class="row row--between page-head">
        <h1>${esc(fullName(s))}</h1>
        <button type="button" class="btn btn--danger btn--sm" id="delete-student">Supprimer la fiche</button>
      </div>
      <div class="grid-2">
        <section class="card section">
          <h2>Identité</h2>
          <form class="form" id="edit-form" novalidate style="padding:0; margin:0">
            ${field("matricule", "Matricule", `maxlength="30" value="${esc(s.matricule)}"`)}
            ${field("first_name", "Prénom", `maxlength="100" value="${esc(s.first_name)}"`)}
            ${field("last_name", "Nom", `maxlength="100" value="${esc(s.last_name)}"`)}
            ${field("level", "Niveau", `maxlength="50" value="${esc(s.level)}"`)}
            <p class="form-error" role="alert"></p>
            <div class="form__actions"><button type="submit" class="btn btn--ghost" id="edit-submit">Enregistrer</button></div>
          </form>
        </section>
        <section class="card section">
          <h2>Accès et carte</h2>
          <p>Compte : ${s.user_id ? `<span class="tag tag--ok">rattaché</span>` : `<span class="tag">en attente</span>`}</p>
          <p class="muted small">Code à remettre à l'étudiant pour créer son espace :</p>
          <p class="row"><span class="code" id="access-code">${esc(s.access_code)}</span>
            <button type="button" class="btn btn--ghost btn--sm" id="copy-code">Copier</button></p>
          <div class="row">
            <button type="button" class="btn btn--ghost btn--sm" id="reset-access">${s.user_id ? "Révoquer l'accès" : "Nouveau code"}</button>
            <button type="button" class="btn btn--ghost btn--sm" id="renew-card">Renouveler la carte QR</button>
          </div>
          <p class="muted small">Renouveler la carte invalide immédiatement l'ancien QR code (perte, vol).</p>
        </section>
      </div>
      <section class="card section">
        <h2>Frais</h2>
        ${feesTable(fees)}
        <form class="form" id="payment-form" novalidate style="padding: var(--space-4) 0 0; margin: 0">
          <h3 class="form__title">Enregistrer un paiement</h3>
          <div class="field"><label for="f-fee">Type de frais</label>
            <select id="f-fee" name="fee">${feeTypes.map((f) => `<option value="${f.id}">${esc(f.name)}</option>`).join("")}</select></div>
          ${field("amount", "Montant ($)", 'inputmode="decimal" placeholder="100"')}
          ${field("paid_on", "Date", `type="date" value="${new Date().toISOString().slice(0, 10)}"`)}
          <p class="form-error" role="alert"></p>
          <div class="form__actions"><button type="submit" class="btn" id="payment-submit" ${feeTypes.length ? "" : "disabled"}>Ajouter le paiement</button></div>
        </form>
        ${payments.length ? `<h3>Historique</h3><ul class="small">${payments.map((p) => `
          <li>${esc(p.paid_on)} · ${esc(feeName.get(p.fee_type_id))} · ${formatMoney(p.amount)}
            <button type="button" class="btn btn--ghost btn--sm" data-del-payment="${p.id}">Annuler</button></li>`).join("")}</ul>` : ""}
      </section>
      ${transcriptHtml(s, t)}`, fullName(s));
    bindPrint();

    view.querySelector("#copy-code").addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(s.access_code); toast("Code copié."); } catch { toast("Copie impossible : sélectionnez le code.", "error"); }
    });
    view.querySelector("#reset-access").addEventListener("click", (e) => {
      if (s.user_id && !confirm("Révoquer l'accès ? L'étudiant ne verra plus son espace jusqu'à ce qu'il saisisse le nouveau code.")) return;
      busy(e.currentTarget, async () => {
        try { await api.resetStudentAccess(s.id); toast("Nouveau code généré."); router(); }
        catch (err) { toast(errorMessage(err), "error"); }
      });
    });
    view.querySelector("#renew-card").addEventListener("click", (e) => {
      if (!confirm("Renouveler la carte ? L'ancien QR code sera refusé à l'entrée.")) return;
      busy(e.currentTarget, async () => {
        try { await api.renewCard(s.id); toast("Carte renouvelée."); }
        catch (err) { toast(errorMessage(err), "error"); }
      });
    });
    view.querySelector("#delete-student").addEventListener("click", (e) => {
      if (!confirm(`Supprimer définitivement la fiche de ${fullName(s)}, ses paiements et ses notes ?`)) return;
      busy(e.currentTarget, async () => {
        try { await api.deleteStudent(s.id); toast("Fiche supprimée."); location.hash = "#/etudiants"; }
        catch (err) { toast(errorMessage(err), "error"); }
      });
    });
    view.querySelectorAll("[data-del-payment]").forEach((b) => b.addEventListener("click", () => {
      if (!confirm("Annuler ce paiement ?")) return;
      busy(b, async () => {
        try { await api.deletePayment(b.dataset.delPayment); toast("Paiement annulé."); router(); }
        catch (err) { toast(errorMessage(err), "error"); }
      });
    }));

    const edit = view.querySelector("#edit-form");
    edit.addEventListener("submit", async (e) => {
      e.preventDefault();
      clearErrors(edit);
      const v = validate(edit, {
        matricule: (x) => parseText(x, "Le matricule", 30),
        first_name: (x) => parseText(x, "Le prénom"),
        last_name: (x) => parseText(x, "Le nom"),
        level: (x) => ({ ok: true, value: String(x).trim().slice(0, 50) }),
      });
      if (!v) return;
      await busy(edit.querySelector("#edit-submit"), async () => {
        try { await api.saveStudent({ id: s.id, ...v }); toast("Fiche mise à jour."); router(); }
        catch (err) { formError(edit, err); }
      });
    });

    const pay = view.querySelector("#payment-form");
    pay.addEventListener("submit", async (e) => {
      e.preventDefault();
      clearErrors(pay);
      const v = validate(pay, {
        amount: parseAmount,
        paid_on: (x) => (/^\d{4}-\d{2}-\d{2}$/.test(x) ? { ok: true, value: x } : { ok: false, error: "Date invalide." }),
      });
      if (!v) return;
      await busy(pay.querySelector("#payment-submit"), async () => {
        try { await api.addPayment({ student_id: s.id, fee_type_id: pay.elements.fee.value, ...v }); toast("Paiement enregistré."); router(); }
        catch (err) { formError(pay, err); }
      });
    });
  } catch (err) {
    if (isCurrent()) showError(err, router);
  }
}

// ---------- Admin : comptes ----------
async function viewMembers({ isCurrent }) {
  loading();
  try {
    const members = await api.listMembers();
    if (!isCurrent()) return;
    render(`
      <h1>Comptes</h1>
      <p class="notice small">Les étudiants n'apparaissent pas ici : ils rattachent leur compte avec le code de leur fiche. Attribuez un rôle aux enseignants et aux agents.</p>
      <div class="table-wrap"><table class="table">
        <caption class="sr-only">Comptes du personnel</caption>
        <thead><tr><th scope="col">E-mail</th><th scope="col">Inscrit le</th><th scope="col">Rôle</th></tr></thead>
        <tbody>${members.map((m) => `
          <tr>
            <th scope="row">${esc(m.email)}${m.user_id === session.user.id ? ` <span class="tag">vous</span>` : ""}</th>
            <td data-label="Inscrit le">${formatDateTime(m.created_at)}</td>
            <td data-label="Rôle">${m.user_id === session.user.id ? ROLE_LABEL[m.role] : `
              <select data-member="${m.user_id}" aria-label="Rôle de ${esc(m.email)}">
                <option value="" ${m.role ? "" : "selected"}>Aucun (en attente ou étudiant)</option>
                ${["enseignant", "agent", "admin"].map((r) => `<option value="${r}" ${m.role === r ? "selected" : ""}>${ROLE_LABEL[r]}</option>`).join("")}
              </select>`}</td>
          </tr>`).join("")}</tbody>
      </table></div>`, "Comptes");
    view.querySelectorAll("[data-member]").forEach((sel) => sel.addEventListener("change", async () => {
      sel.disabled = true;
      try { await api.setMemberRole(sel.dataset.member, sel.value); toast("Rôle mis à jour."); }
      catch (err) { toast(errorMessage(err), "error"); router(); }
      finally { sel.disabled = false; }
    }));
  } catch (err) {
    if (isCurrent()) showError(err, router);
  }
}

// ---------- Admin : types de frais ----------
async function viewFeeTypes({ isCurrent }) {
  loading();
  try {
    const fees = await api.listFeeTypes();
    if (!isCurrent()) return;
    render(`
      <h1>Types de frais</h1>
      <form class="card form" id="fee-form" novalidate>
        <input type="hidden" name="id">
        <h2 class="form__title">Ajouter ou modifier</h2>
        ${field("name", "Intitulé", 'maxlength="100" placeholder="Frais de scolarité"')}
        ${field("amount_due", "Montant dû ($)", 'inputmode="decimal" placeholder="925"')}
        <label class="row"><input type="checkbox" name="required" checked style="width:auto; min-height:0"> Exigé pour l'accès au campus</label>
        <p class="form-error" role="alert"></p>
        <div class="form__actions">
          <button type="submit" class="btn" id="fee-submit">Ajouter</button>
          <button type="button" class="btn btn--ghost" id="fee-cancel" hidden>Annuler</button>
        </div>
      </form>
      ${fees.length === 0 ? `<p class="state">Aucun type de frais.</p>` : `
      <div class="table-wrap"><table class="table">
        <caption class="sr-only">Types de frais</caption>
        <thead><tr><th scope="col">Intitulé</th><th scope="col" class="num">Montant dû</th><th scope="col">Accès</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead>
        <tbody>${fees.map((f) => `
          <tr>
            <th scope="row">${esc(f.name)}</th>
            <td data-label="Montant dû" class="num">${formatMoney(f.amount_due)}</td>
            <td data-label="Accès">${f.required_for_access ? "Exigé" : "Facultatif"}</td>
            <td class="actions">
              <button type="button" class="btn btn--ghost btn--sm" data-edit="${f.id}">Modifier</button>
              <button type="button" class="btn btn--danger btn--sm" data-del="${f.id}">Supprimer</button>
            </td>
          </tr>`).join("")}</tbody>
      </table></div>`}`, "Frais");

    const form = view.querySelector("#fee-form");
    view.querySelector("#fee-cancel").addEventListener("click", () => router());
    view.querySelectorAll("[data-edit]").forEach((b) => b.addEventListener("click", () => {
      const f = fees.find((x) => x.id === b.dataset.edit);
      form.elements.id.value = f.id; form.elements.name.value = f.name;
      form.elements.amount_due.value = String(f.amount_due).replace(".", ","); form.elements.required.checked = f.required_for_access;
      view.querySelector("#fee-submit").textContent = "Enregistrer"; view.querySelector("#fee-cancel").hidden = false;
    }));
    view.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", () => {
      const f = fees.find((x) => x.id === b.dataset.del);
      if (!confirm(`Supprimer « ${f.name} » ?`)) return;
      busy(b, async () => {
        try { await api.deleteFeeType(f.id); toast("Type de frais supprimé."); router(); }
        catch (err) { toast(errorMessage(err), "error"); }
      });
    }));
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      clearErrors(form);
      const v = validate(form, { name: (x) => parseText(x, "L'intitulé"), amount_due: parseAmount });
      if (!v) return;
      await busy(view.querySelector("#fee-submit"), async () => {
        try {
          await api.saveFeeType({ id: form.elements.id.value || null, name: v.name, amount_due: v.amount_due, required_for_access: form.elements.required.checked });
          toast("Type de frais enregistré."); router();
        } catch (err) { formError(form, err); }
      });
    });
  } catch (err) {
    if (isCurrent()) showError(err, router);
  }
}

// ---------- Admin : journal des contrôles ----------
async function viewJournal({ isCurrent }) {
  loading();
  try {
    const [checks, students, members] = await Promise.all([api.listChecks(100), api.listStudents(), api.listMembers()]);
    if (!isCurrent()) return;
    const sName = new Map(students.map((s) => [s.id, fullName(s)]));
    const mName = new Map(members.map((m) => [m.user_id, m.email]));
    const allowed = checks.filter((c) => c.allowed).length;
    render(`
      <h1>Journal des contrôles</h1>
      <p class="muted">${checks.length} derniers contrôles · ${allowed} autorisés · ${checks.length - allowed} refusés</p>
      ${checks.length === 0 ? `<p class="state">Aucun contrôle enregistré.</p>` : `
      <div class="table-wrap"><table class="table">
        <caption class="sr-only">Journal des contrôles</caption>
        <thead><tr><th scope="col">Date</th><th scope="col">Étudiant</th><th scope="col">Verdict</th><th scope="col">Agent</th></tr></thead>
        <tbody>${checks.map((c) => `
          <tr>
            <th scope="row">${formatDateTime(c.checked_at)}</th>
            <td data-label="Étudiant">${c.student_id ? `<a href="#/etudiant/${c.student_id}">${esc(sName.get(c.student_id) ?? "—")}</a>` : `<span class="muted">carte inconnue</span>`}</td>
            <td data-label="Verdict"><span class="tag ${c.allowed ? "tag--ok" : "tag--bad"}">${c.allowed ? "autorisé" : "refusé"}</span> ${esc(c.reason)}</td>
            <td data-label="Agent">${esc(mName.get(c.agent_id) ?? "—")}</td>
          </tr>`).join("")}</tbody>
      </table></div>`}`, "Journal");
  } catch (err) {
    if (isCurrent()) showError(err, router);
  }
}

// ---------- Démarrage ----------
function notConfigured() {
  nav.hidden = true;
  account.hidden = true;
  view.innerHTML = `
    <div class="state state--error" role="alert">
      <p><strong>Application non configurée.</strong></p>
      <p>Renseignez l'URL et la clé publique de votre projet Supabase dans <code>js/config.js</code> (voir le README).</p>
    </div>`;
}

async function start() {
  if (!api.isConfigured) return notConfigured();
  document.getElementById("logout").addEventListener("click", (e) => busy(e.currentTarget, async () => {
    try { await api.auth.signOut(); } catch (err) { toast(errorMessage(err), "error"); }
  }));
  window.addEventListener("hashchange", router);
  try {
    session = await api.auth.session();
    await refreshRole();
  } catch (err) {
    return showError(err, () => location.reload());
  }
  document.getElementById("account-email").textContent = session?.user.email ?? "";
  api.auth.onChange(async (next) => {
    const changed = (next?.user.id ?? null) !== (session?.user.id ?? null);
    session = next;
    if (!changed) return;
    document.getElementById("account-email").textContent = session?.user.email ?? "";
    try { await refreshRole(); } catch (err) { return showError(err, () => location.reload()); }
    if (location.hash === (session ? home() : "#/connexion")) router();
    else location.hash = session ? home() : "#/connexion";
  });
  router();
}

start();
