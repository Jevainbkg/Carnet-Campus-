import { test } from "node:test";
import assert from "node:assert/strict";
import {
  weightedAverage, formatPercent, formatMoney, feeStatus, parseGrade, parseCoefficient, parseAmount,
  parseText, parseAccessCode, cardPayload, parseCardPayload, searchStudents, errorMessage,
} from "../app/js/calc.js";

test("moyenne pondérée : 10 (coef 1) et 16 (coef 2) = 14, matière non notée ignorée", () => {
  assert.equal(weightedAverage([{ value: 10, coefficient: 1 }, { value: 16, coefficient: 2 }, { value: null, coefficient: 3 }]), 14);
  assert.equal(weightedAverage([]), null);
});

test("pourcentage et montant", () => {
  assert.equal(formatPercent(14), "70 %");
  assert.equal(formatPercent(null), "—");
  assert.equal(formatMoney(925), "925,00 $");
});

test("statut d'un frais : payé, acompte, impayé (même règle que la vue SQL)", () => {
  assert.equal(feeStatus(925, 925), "paye");
  assert.equal(feeStatus(1000, 925), "paye");
  assert.equal(feeStatus(300, 925), "acompte");
  assert.equal(feeStatus(0, 925), "impaye");
  assert.equal(feeStatus(null, 925), "impaye");
});

test("saisie d'une note", () => {
  assert.deepEqual(parseGrade("13,5"), { ok: true, value: 13.5 });
  assert.equal(parseGrade("21").ok, false);
  assert.equal(parseGrade("-1").ok, false);
  assert.equal(parseGrade("").ok, false);
});

test("coefficient et montant", () => {
  assert.equal(parseCoefficient("0").ok, false);
  assert.deepEqual(parseCoefficient("2"), { ok: true, value: 2 });
  assert.deepEqual(parseAmount("1 250,50"), { ok: true, value: 1250.5 });
  assert.equal(parseAmount("0").ok, false);
  assert.equal(parseAmount("-5").ok, false);
  assert.equal(parseAmount("12,345").ok, false);
});

test("texte obligatoire", () => {
  assert.deepEqual(parseText("  Alice   Demo ", "Le nom"), { ok: true, value: "Alice Demo" });
  assert.equal(parseText("   ", "Le nom").ok, false);
});

test("code d'accès étudiant normalisé", () => {
  assert.deepEqual(parseAccessCode("a1b2 c3d4e5f6"), { ok: true, value: "A1B2-C3D4-E5F6" });
  assert.equal(parseAccessCode("XYZ").ok, false);
});

test("QR de carte : jeton opaque avec préfixe, saisie manuelle acceptée", () => {
  const t = "5763c957-261b-4be6-aa33-2b4790aa2d53";
  assert.equal(cardPayload(t), "carnet-campus:" + t);
  assert.equal(parseCardPayload(cardPayload(t)), t);
  assert.equal(parseCardPayload(t.toUpperCase()), t);
  assert.equal(parseCardPayload("CC2026001"), null);
  assert.equal(parseCardPayload("https://exemple.com"), null);
});

test("recherche par nom ou matricule, sans accents", () => {
  const rows = [{ first_name: "Chloé", last_name: "Demo", matricule: "CC1" }, { first_name: "Bruno", last_name: "X", matricule: "CC2" }];
  assert.equal(searchStudents(rows, "chloe").length, 1);
  assert.equal(searchStudents(rows, "cc2")[0].first_name, "Bruno");
  assert.equal(searchStudents(rows, "").length, 2);
});

test("messages d'erreur lisibles", () => {
  assert.equal(errorMessage({ code: "23505", message: "students_matricule_key" }), "Ce matricule existe déjà.");
  assert.equal(errorMessage({ code: "P0002", message: "Code invalide ou déjà utilisé." }), "Code invalide ou déjà utilisé.");
  assert.equal(errorMessage({ code: "42501", message: "new row violates row-level security policy" }), "Accès refusé.");
  assert.equal(errorMessage({ message: "Invalid login credentials" }), "E-mail ou mot de passe incorrect.");
});
