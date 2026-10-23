// Test d'interface de bout en bout (Playwright + Chromium) avec un faux Supabase en mémoire.
// Usage : node tests/e2e/ui.test.mjs [dossier-captures]
// Vérifie les parcours des 4 rôles ; la sécurité réelle est prouvée par tests/db/rls.test.sql.
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const here = dirname(fileURLToPath(import.meta.url));
const appDir = join(here, "../../app");
const shots = process.argv[2];
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" };

const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  try {
    const body = await readFile(join(appDir, path === "/" ? "index.html" : path));
    res.writeHead(200, { "content-type": types[extname(path)] ?? "text/html; charset=utf-8" }).end(body);
  } catch { res.writeHead(404).end(); }
}).listen(0);
const base = `http://127.0.0.1:${server.address().port}/`;

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const results = [];
const step = async (name, fn) => {
  try { await fn(); results.push(`PASS ${name}`); }
  catch (e) { results.push(`FAIL ${name} — ${e.message.slice(0, 400)}`); }
};

async function newPage(viewport, colorScheme = "light") {
  const ctx = await browser.newContext({ viewport, colorScheme });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => d.accept());
  await page.route("https://cdn.jsdelivr.net/**", async (r) => {
    const url = r.request().url();
    if (url.includes("supabase-js")) return r.fulfill({ contentType: "text/javascript", body: await readFile(join(here, "fake-supabase.js")) });
    if (url.includes("qrcode-generator")) return r.fulfill({ contentType: "text/javascript", body: await readFile(join(here, "../../node_modules/qrcode-generator/qrcode.js")) });
    return r.fulfill({ status: 404, body: "" });
  });
  await page.route("**/js/config.js", (r) => r.fulfill({ contentType: "text/javascript",
    body: 'export const SUPABASE_URL="https://demo.supabase.co"; export const SUPABASE_ANON_KEY="test";' }));
  const hideToast = () => page.evaluate(() => { const t = document.getElementById("toast"); t.style.transition = "none"; t.classList.remove("is-visible"); });
  const shot = async (name) => { if (shots) { await hideToast(); await page.screenshot({ path: `${shots}/${name}.png`, fullPage: true }); } };
  return { page, errors, shot };
}

const { page, errors, shot } = await newPage({ width: 1440, height: 900 });

async function signUp(email) {
  await page.click("#tab-up");
  await page.fill("#f-email", email);
  await page.fill("#f-password", "secret123");
  await page.click("#auth-submit");
}
async function login(email) {
  await page.fill("#f-email", email);
  await page.fill("#f-password", "secret123");
  await page.click("#auth-submit");
}
async function logout() {
  await page.click("#logout");
  await page.waitForURL(/#\/connexion/);
}

await page.goto(base);

await step("non connecté → écran de connexion, validation du formulaire", async () => {
  await page.waitForURL(/#\/connexion/);
  await page.click("#auth-submit");
  assert.match(await page.textContent('[data-error-for="email"]'), /invalide/);
  await shot("01-connexion");
});

let aliceCode, bobCode;
await step("admin : premier compte → devient administrateur", async () => {
  await signUp("admin@example.test");
  await page.waitForURL(/#\/accueil/);
  await page.click("#first-admin");
  await page.waitForURL(/#\/etudiants/);
  assert.equal(await page.locator("#nav a").count(), 5);
});

await step("admin : inscription d'étudiants, matricule dupliqué refusé", async () => {
  for (const [m, f, l] of [["CC2026001", "Alice", "Demo"], ["CC2026002", "Bruno", "Demo"]]) {
    await page.goto(base + "#/etudiants");
    await page.fill("#f-matricule", m); await page.fill("#f-first_name", f); await page.fill("#f-last_name", l); await page.fill("#f-level", "L2");
    await page.click("#student-submit");
    await page.waitForURL(/#\/etudiant\//);
    const code = (await page.textContent("#access-code")).trim();
    if (f === "Alice") aliceCode = code; else bobCode = code;
  }
  await page.goto(base + "#/etudiants");
  await page.fill("#f-matricule", "CC2026001"); await page.fill("#f-first_name", "X"); await page.fill("#f-last_name", "Y");
  await page.click("#student-submit");
  await page.locator(".form-error", { hasText: "existe déjà" }).waitFor();
});

await step("admin : paiement complet d'Alice, montant invalide refusé", async () => {
  await page.click("text=Alice Demo");
  await page.waitForURL(/#\/etudiant\//);
  await page.fill("#f-amount", "-5");
  await page.click("#payment-submit");
  assert.match(await page.textContent('[data-error-for="amount"]'), /invalide|supérieur/);
  await page.fill("#f-amount", "925");
  await page.click("#payment-submit");
  await page.locator("td[data-label='Statut'] .tag--ok").first().waitFor();
  await shot("02-admin-fiche");
  await logout();
});

await step("personnel : un nouveau compte reste en attente", async () => {
  await signUp("prof@example.test");
  await page.waitForURL(/#\/accueil/);
  await page.click("#first-admin");
  await page.locator("#toast", { hasText: "existe déjà" }).waitFor();
  await logout();
  await signUp("agent@example.test");
  await page.waitForURL(/#\/accueil/);
  await logout();
});

let aliceToken;
await step("étudiant : rattachement par code, carte QR et frais", async () => {
  await signUp("alice@example.test");
  await page.waitForURL(/#\/accueil/);
  await page.fill("#f-code", "0000-0000-0000");
  await page.click("#join-submit");
  await page.locator(".form-error", { hasText: "invalide" }).waitFor();
  await page.fill("#f-code", aliceCode.toLowerCase());
  await page.click("#join-submit");
  await page.waitForURL(/#\/carte/);
  await page.locator("#qr svg").waitFor();
  aliceToken = (await page.textContent("#card-token")).trim();
  assert.match(aliceToken, /^[0-9a-f-]{36}$/);
  assert.equal(await page.locator(".tag--ok", { hasText: "Payé" }).count(), 1);
  await shot("03-etudiant-carte");
  await logout();
});

await step("admin : attribution des rôles enseignant et agent", async () => {
  await login("admin@example.test");
  await page.waitForURL(/#\/etudiants/);
  await page.click('a[data-route="membres"]');
  await page.selectOption('select[aria-label="Rôle de prof@example.test"]', "enseignant");
  await page.locator("#toast", { hasText: "Rôle mis à jour" }).waitFor();
  await page.selectOption('select[aria-label="Rôle de agent@example.test"]', "agent");
  await page.locator("#toast", { hasText: "Rôle mis à jour" }).waitFor();
  assert.equal(await page.locator('select[aria-label="Rôle de alice@example.test"]').inputValue(), "");
  await logout();
});

await step("enseignant : matières (coef. 0 refusé) et saisie des notes (21 refusé)", async () => {
  await login("prof@example.test");
  await page.waitForURL(/#\/matieres/);
  for (const [n, c] of [["Mathématiques", "0"], ["Mathématiques", "1"], ["Physique", "2"]]) {
    await page.fill("#f-name", n); await page.fill("#f-coefficient", c);
    await page.click("#subject-submit");
    if (c === "0") { await page.locator('[data-error-for="coefficient"]', { hasText: "compris" }).waitFor(); continue; }
    await page.locator("th", { hasText: n }).waitFor();
  }
  await page.click('a[data-route="saisie"]');
  const alice = page.locator(".grade-row", { hasText: "Alice" });
  await alice.locator("input").fill("21");
  await alice.getByRole("button", { name: "Enregistrer" }).click();
  await alice.locator(".field__error", { hasText: "entre 0 et 20" }).waitFor();
  await alice.locator("input").fill("10");
  await alice.getByRole("button", { name: "Enregistrer" }).click();
  await alice.getByRole("button", { name: "Effacer" }).waitFor();
  await page.selectOption("#subject-select", { label: "Physique (coef. 2)" });
  await page.locator(".grade-row", { hasText: "Alice" }).locator("input").fill("16");
  await page.locator(".grade-row", { hasText: "Alice" }).getByRole("button", { name: "Enregistrer" }).click();
  await page.locator(".grade-row", { hasText: "Alice" }).getByRole("button", { name: "Effacer" }).waitFor();
  await shot("04-enseignant-saisie");
  await logout();
});

await step("étudiant : relevé en lecture seule, moyenne 14,00 et 70 %", async () => {
  await login("alice@example.test");
  await page.waitForURL(/#\/carte/);
  await page.click('a[data-route="releve"]');
  await page.locator("#average", { hasText: "14,00" }).waitFor();
  assert.ok((await page.textContent("tfoot")).includes("70"));
  assert.equal(await page.locator("input").count(), 0);
  await logout();
});

await step("agent : contrôle impossible hors service, puis verdicts", async () => {
  await login("agent@example.test");
  await page.waitForURL(/#\/controle/);
  assert.ok(await page.locator("#manual-submit").isDisabled());
  await page.click("#duty-toggle");
  await page.locator("#duty-state", { hasText: "En service" }).waitFor();
  await page.fill("#f-token", "carnet-campus:" + aliceToken);
  await page.click("#manual-submit");
  await page.locator(".verdict--ok", { hasText: "Accès autorisé" }).waitFor();
  assert.ok((await page.textContent("#verdict")).includes("CC2026001"));
  await shot("05-agent-verdict");
  await page.fill("#f-token", crypto.randomUUID());
  await page.click("#manual-submit");
  await page.locator(".verdict--no", { hasText: "Carte invalide" }).waitFor();
  await page.fill("#f-token", "bonjour");
  await page.click("#manual-submit");
  await page.locator('[data-error-for="token"]', { hasText: "invalide" }).waitFor();
  assert.equal(await page.locator("#checks li").count(), 2);
});

await step("agent : alerte créée puis résolue", async () => {
  await page.click('a[data-route="alertes"]');
  await page.fill("#f-place", "Portail B");
  await page.fill("#f-description", "Porte forcée");
  await page.click("#alert-submit");
  await page.locator(".tag--bad", { hasText: "Ouverte" }).waitFor();
  await page.click("[data-resolve]");
  await page.locator(".tag--ok", { hasText: "Résolue" }).waitFor();
  await logout();
});

await step("admin : journal des contrôles, carte renouvelée refusée", async () => {
  await login("admin@example.test");
  await page.waitForURL(/#\/etudiants/);
  await page.click('a[data-route="journal"]');
  await page.locator("text=2 derniers contrôles · 1 autorisés · 1 refusés").waitFor();
  await page.click("text=Alice Demo");
  await page.click("#renew-card");
  await page.locator("#toast", { hasText: "Carte renouvelée" }).waitFor();
  await logout();
  await login("agent@example.test");
  await page.waitForURL(/#\/controle/);
  await page.fill("#f-token", aliceToken);
  await page.click("#manual-submit");
  await page.locator(".verdict--no").waitFor();
  await logout();
});

await step("rôle : un étudiant ne peut pas ouvrir les écrans admin", async () => {
  await login("alice@example.test");
  await page.waitForURL(/#\/carte/);
  await page.goto(base + "#/etudiants");
  await page.waitForURL(/#\/carte/);
  assert.equal(await page.locator('#nav a[data-route="etudiants"]').count(), 0);
});

await step("bouton jour / nuit : bascule et mémorise le choix", async () => {
  const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const light = await bg();
  await page.click("#theme-toggle");
  assert.notEqual(await bg(), light);
  await page.reload();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "dark");
  await page.click("#theme-toggle");
  assert.equal(await bg(), light);
});

await step("aucune erreur JavaScript", async () => assert.deepEqual(errors, []));

await step("mobile 375 px + thème sombre : pas de débordement horizontal", async () => {
  const m = await newPage({ width: 375, height: 812 }, "dark");
  await m.page.goto(base);
  await m.page.click("#tab-up");
  await m.page.fill("#f-email", "admin@example.test");
  await m.page.fill("#f-password", "secret123");
  await m.page.click("#auth-submit");
  await m.page.click("#first-admin");
  await m.page.waitForURL(/#\/etudiants/);
  await m.page.fill("#f-matricule", "CC2026009"); await m.page.fill("#f-first_name", "Mobile"); await m.page.fill("#f-last_name", "Demo");
  await m.page.click("#student-submit");
  await m.page.waitForURL(/#\/etudiant\//);
  for (const route of ["etudiants", "membres", "frais", "journal", "alertes"]) {
    await m.page.goto(base + "#/" + route);
    await m.page.waitForTimeout(250);
    const overflow = await m.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(overflow <= 0, `${route} déborde de ${overflow}px`);
  }
  await m.page.goto(base + "#/etudiants");
  await m.page.locator("#student-list table").waitFor();
  await m.shot("06-mobile-sombre");
  assert.deepEqual(m.errors, []);
});

await browser.close();
server.close();
console.log(results.join("\n"));
const failed = results.filter((r) => r.startsWith("FAIL")).length;
console.log(`\n${results.length - failed}/${results.length} PASS`);
process.exit(failed ? 1 : 0);
