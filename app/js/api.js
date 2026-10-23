// Accès aux données : toutes les requêtes Supabase passent par ce module.
// La sécurité est dans la base (RLS + fonctions) : ce module ne fait qu'appeler.
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";
import { weightedAverage } from "./calc.js";

export const isConfigured = /^https:\/\/.+/.test(SUPABASE_URL) && !SUPABASE_ANON_KEY.includes("REMPLACER");

export const supabase = isConfigured ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

function unwrap({ data, error }) {
  if (error) throw error;
  return data;
}

const rpc = async (name, args = {}) => unwrap(await supabase.rpc(name, args));

// ---------- Authentification ----------
export const auth = {
  async session() {
    return unwrap(await supabase.auth.getSession()).session;
  },
  async signIn(email, password) {
    return unwrap(await supabase.auth.signInWithPassword({ email, password }));
  },
  async signUp(email, password) {
    return unwrap(await supabase.auth.signUp({
      email, password, options: { emailRedirectTo: location.origin + location.pathname },
    }));
  },
  async signOut() {
    unwrap(await supabase.auth.signOut());
  },
  onChange(cb) {
    supabase.auth.onAuthStateChange((_event, session) => cb(session));
  },
};

// ---------- Rôles ----------
export const myRole = () => rpc("my_role");
export const claimFirstAdmin = () => rpc("claim_first_admin");
export const claimStudent = (code) => rpc("claim_student", { p_code: code });

export async function listMembers() {
  return unwrap(await supabase.from("members").select("user_id, email, full_name, role, on_duty, created_at").order("created_at"));
}
export const setMemberRole = (userId, role) => rpc("set_member_role", { p_user: userId, p_role: role || null });

// ---------- Étudiants ----------
const STUDENT_COLS = "id, matricule, last_name, first_name, level, user_id, access_code, card_token";

export async function listStudents() {
  return unwrap(await supabase.from("students").select(STUDENT_COLS).order("last_name").order("first_name"));
}
export async function getStudent(id) {
  return unwrap(await supabase.from("students").select(STUDENT_COLS).eq("id", id).maybeSingle());
}
// Fiche de l'étudiant connecté (la RLS ne laisse voir que la sienne).
export async function myStudent(userId) {
  return unwrap(await supabase.from("students").select(STUDENT_COLS).eq("user_id", userId).maybeSingle());
}
export async function saveStudent({ id, matricule, last_name, first_name, level }) {
  const row = { matricule, last_name, first_name, level };
  const q = id ? supabase.from("students").update(row).eq("id", id) : supabase.from("students").insert(row);
  return unwrap(await q.select(STUDENT_COLS).single());
}
export async function deleteStudent(id) {
  unwrap(await supabase.from("students").delete().eq("id", id));
}
export const resetStudentAccess = (id) => rpc("reset_student_access", { p_student: id });
export const renewCard = (id) => rpc("renew_card", { p_student: id });

// ---------- Frais ----------
export async function listFeeTypes() {
  return unwrap(await supabase.from("fee_types").select("id, name, amount_due, required_for_access").order("name"));
}
export async function saveFeeType({ id, name, amount_due, required_for_access }) {
  const row = { name, amount_due, required_for_access };
  const q = id ? supabase.from("fee_types").update(row).eq("id", id) : supabase.from("fee_types").insert(row);
  return unwrap(await q.select().single());
}
export async function deleteFeeType(id) {
  unwrap(await supabase.from("fee_types").delete().eq("id", id));
}
export async function feeStatus(studentId) {
  return unwrap(await supabase.from("fee_status").select("fee_type_id, name, amount_due, required_for_access, paid, status").eq("student_id", studentId).order("name"));
}
// Statuts de tous les étudiants visibles (admin) : Map student_id → liste.
export async function allFeeStatus() {
  const rows = unwrap(await supabase.from("fee_status").select("student_id, required_for_access, status"));
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.student_id)) map.set(r.student_id, []);
    map.get(r.student_id).push(r);
  }
  return map;
}
export async function listPayments(studentId) {
  return unwrap(await supabase.from("payments").select("id, fee_type_id, amount, paid_on").eq("student_id", studentId).order("paid_on", { ascending: false }));
}
export async function addPayment({ student_id, fee_type_id, amount, paid_on }) {
  return unwrap(await supabase.from("payments").insert({ student_id, fee_type_id, amount, paid_on }).select().single());
}
export async function deletePayment(id) {
  unwrap(await supabase.from("payments").delete().eq("id", id));
}

// ---------- Matières et notes ----------
export async function listSubjects() {
  return unwrap(await supabase.from("subjects").select("id, teacher_id, name, coefficient").order("name"));
}
export async function saveSubject({ id, name, coefficient }) {
  const q = id
    ? supabase.from("subjects").update({ name, coefficient }).eq("id", id)
    : supabase.from("subjects").insert({ name, coefficient });
  return unwrap(await q.select().single());
}
export async function deleteSubject(id) {
  unwrap(await supabase.from("subjects").delete().eq("id", id));
}
export async function gradesForSubject(subjectId) {
  return unwrap(await supabase.from("grades").select("id, student_id, value").eq("subject_id", subjectId));
}
export async function gradesForStudent(studentId) {
  return unwrap(await supabase.from("grades").select("id, subject_id, value").eq("student_id", studentId));
}
export async function upsertGrade(student_id, subject_id, value) {
  return unwrap(await supabase.from("grades")
    .upsert({ student_id, subject_id, value }, { onConflict: "student_id,subject_id" })
    .select().single());
}
export async function deleteGrade(student_id, subject_id) {
  unwrap(await supabase.from("grades").delete().eq("student_id", student_id).eq("subject_id", subject_id));
}

/** Relevé d'un étudiant : matières (toutes celles visibles), notes, moyenne pondérée. */
export async function transcript(studentId) {
  const [subjects, grades] = await Promise.all([listSubjects(), gradesForStudent(studentId)]);
  const bySubject = new Map(grades.map((g) => [g.subject_id, Number(g.value)]));
  const lines = subjects.map((s) => ({ ...s, value: bySubject.has(s.id) ? bySubject.get(s.id) : null }));
  return { lines, average: weightedAverage(lines) };
}

// ---------- Contrôle d'accès ----------
export const setOnDuty = (on) => rpc("set_on_duty", { p_on: on });
export const verifyCard = (token) => rpc("verify_card", { p_token: token });

export async function myMember(userId) {
  return unwrap(await supabase.from("members").select("user_id, email, full_name, role, on_duty").eq("user_id", userId).maybeSingle());
}
export async function listChecks(limit = 20) {
  return unwrap(await supabase.from("checks").select("id, agent_id, student_id, allowed, reason, checked_at").order("checked_at", { ascending: false }).limit(limit));
}
export async function listAlerts() {
  return unwrap(await supabase.from("alerts").select("id, agent_id, place, description, created_at, resolved_at").order("created_at", { ascending: false }));
}
export async function addAlert(place, description) {
  return unwrap(await supabase.from("alerts").insert({ place, description }).select().single());
}
export const resolveAlert = (id) => rpc("resolve_alert", { p_alert: id });
