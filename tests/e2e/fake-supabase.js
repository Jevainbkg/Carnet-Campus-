// Faux client Supabase en mémoire, utilisé UNIQUEMENT par le test d'interface (tests/e2e/ui.test.mjs).
// Reproduit le sous-ensemble d'API utilisé par app/js/api.js et une version simplifiée des règles
// d'accès. La vraie sécurité est prouvée sur Postgres par tests/db/rls.test.sql.
const db = {
  users: [], members: [], students: [], payments: [], subjects: [], grades: [], checks: [], alerts: [],
  fee_types: [
    { id: "f1", name: "Frais de scolarité", amount_due: 925, required_for_access: true },
    { id: "f2", name: "Frais informatiques", amount_due: 20, required_for_access: false },
  ],
};
let current = null;
const listeners = [];
const uid = () => crypto.randomUUID();
const err = (code, message) => ({ code, message });
const wait = () => new Promise((r) => setTimeout(r, 20));
const newCode = () => uid().replace(/-/g, "").slice(0, 12).toUpperCase().replace(/(.{4})(.{4})(.{4})/, "$1-$2-$3");

const member = () => db.members.find((m) => m.user_id === current?.id);
const has = (r) => member()?.role === r;
const myStudent = () => db.students.find((s) => s.user_id === current?.id);

function feeStatusRows() {
  const rows = [];
  for (const s of db.students) for (const f of db.fee_types) {
    const paid = db.payments.filter((p) => p.student_id === s.id && p.fee_type_id === f.id).reduce((a, p) => a + Number(p.amount), 0);
    rows.push({ student_id: s.id, fee_type_id: f.id, name: f.name, amount_due: f.amount_due, required_for_access: f.required_for_access, paid,
      status: paid >= f.amount_due ? "paye" : paid > 0 ? "acompte" : "impaye" });
  }
  return rows;
}

function readable(table, r) {
  const me = myStudent();
  switch (table) {
    case "members": return r.user_id === current.id || has("admin");
    case "students": return has("admin") || has("enseignant") || r.user_id === current.id;
    case "fee_types": return true;
    case "payments": case "fee_status": return has("admin") || r.student_id === me?.id;
    case "subjects": return has("admin") || has("enseignant") || !!me;
    case "grades": return has("admin") || r.student_id === me?.id || db.subjects.some((m) => m.id === r.subject_id && m.teacher_id === current.id);
    case "checks": return r.agent_id === current.id || has("admin");
    case "alerts": return has("agent") || has("admin");
  }
  return false;
}

function writable(table, r) {
  switch (table) {
    case "students": case "fee_types": case "payments": return has("admin");
    case "subjects": return has("admin") || (has("enseignant") && r.teacher_id === current.id);
    case "grades": return has("enseignant") && db.subjects.some((m) => m.id === r.subject_id && m.teacher_id === current.id);
    case "alerts": return has("agent") && r.agent_id === current.id;
  }
  return false;
}

function check(table, r) {
  if (table === "grades") {
    if (!(r.value >= 0 && r.value <= 20)) return err("23514", "grades_value_check");
    if (db.grades.some((g) => g.id !== r.id && g.student_id === r.student_id && g.subject_id === r.subject_id)) return err("23505", "grades_student_subject_key");
  }
  if (table === "students" && db.students.some((s) => s.id !== r.id && s.matricule === r.matricule)) return err("23505", "students_matricule_key");
  if (table === "subjects" && db.subjects.some((s) => s.id !== r.id && s.name === r.name)) return err("23505", "subjects_name_key");
  if (table === "fee_types" && db.fee_types.some((s) => s.id !== r.id && s.name === r.name)) return err("23505", "fee_types_name_key");
  return null;
}

class Query {
  constructor(table) { this.table = table; this.filters = []; this.op = "select"; this.mode = "many"; }
  select() { return this; }
  order(col, opts) { (this.orders ??= []).push([col, opts?.ascending !== false]); return this; }
  limit(n) { this.max = n; return this; }
  eq(col, val) { this.filters.push([col, val]); return this; }
  insert(row) { this.op = "insert"; this.payload = row; return this; }
  update(row) { this.op = "update"; this.payload = row; return this; }
  delete() { this.op = "delete"; return this; }
  upsert(row) { this.op = "upsert"; this.payload = row; return this; }
  single() { this.mode = "single"; return this; }
  maybeSingle() { this.mode = "maybe"; return this; }
  then(resolve, reject) { return wait().then(() => this.run()).then(resolve, reject); }

  source() { return this.table === "fee_status" ? feeStatusRows() : db[this.table]; }
  match(r) { return this.filters.every(([c, v]) => r[c] === v); }

  run() {
    if (!current) return { data: null, error: err("42501", "not authenticated") };
    const t = this.table;
    let rows;
    if (this.op === "select") {
      rows = this.source().filter((r) => readable(t, r) && this.match(r)).map((r) => ({ ...r }));
      for (const [col, asc] of [...(this.orders ?? [])].reverse()) rows.sort((a, b) => String(a[col]).localeCompare(String(b[col])) * (asc ? 1 : -1));
      if (this.max) rows = rows.slice(0, this.max);
    } else if (this.op === "insert" || this.op === "upsert") {
      const existing = this.op === "upsert" && db.grades.find((g) => g.student_id === this.payload.student_id && g.subject_id === this.payload.subject_id);
      if (existing) {
        if (!writable(t, existing)) return { data: null, error: err("42501", "row-level security") };
        const e = check(t, { ...existing, ...this.payload }); if (e) return { data: null, error: e };
        Object.assign(existing, this.payload); rows = [{ ...existing }];
      } else {
        const row = { id: uid(), ...this.payload };
        if (t === "students") Object.assign(row, { user_id: null, access_code: newCode(), card_token: uid() });
        if (t === "subjects") row.teacher_id = current.id;
        if (t === "alerts") Object.assign(row, { agent_id: current.id, created_at: new Date().toISOString(), resolved_at: null });
        if (!writable(t, row)) return { data: null, error: err("42501", "row-level security") };
        const e = check(t, row); if (e) return { data: null, error: e };
        db[t].push(row); rows = [{ ...row }];
      }
    } else if (this.op === "update") {
      rows = [];
      for (const r of db[t].filter((x) => this.match(x) && writable(t, x))) {
        const next = { ...r, ...this.payload };
        const e = check(t, next); if (e) return { data: null, error: e };
        Object.assign(r, next); rows.push({ ...r });
      }
    } else {
      const ids = new Set(db[t].filter((x) => this.match(x) && writable(t, x)).map((r) => r.id));
      db[t] = db[t].filter((r) => !ids.has(r.id));
      if (t === "students") { db.payments = db.payments.filter((p) => !ids.has(p.student_id)); db.grades = db.grades.filter((g) => !ids.has(g.student_id)); }
      if (t === "subjects") db.grades = db.grades.filter((g) => !ids.has(g.subject_id));
      return { data: null, error: null };
    }
    if (this.mode === "single") return rows.length === 1 ? { data: rows[0], error: null } : { data: null, error: err("PGRST116", "no row") };
    if (this.mode === "maybe") return { data: rows[0] ?? null, error: null };
    return { data: rows, error: null };
  }
}

const RPC = {
  my_role: () => member()?.role ?? (myStudent() ? "etudiant" : null),
  claim_first_admin: () => {
    if (db.members.some((m) => m.role === "admin") || myStudent()) return false;
    member().role = "admin"; return true;
  },
  set_member_role: ({ p_user, p_role }) => {
    if (!has("admin")) throw err("42501", "Réservé à l'administrateur.");
    const m = db.members.find((x) => x.user_id === p_user);
    m.role = p_role; if (p_role !== "agent") m.on_duty = false;
  },
  claim_student: ({ p_code }) => {
    if (member()?.role) throw err("P0001", "Ce compte a déjà un rôle : créez un compte séparé pour l'étudiant.");
    const s = db.students.find((x) => x.access_code === p_code.trim().toUpperCase() && !x.user_id);
    if (!s) throw err("P0002", "Code invalide ou déjà utilisé.");
    s.user_id = current.id; return s.id;
  },
  reset_student_access: ({ p_student }) => {
    const s = db.students.find((x) => x.id === p_student); s.user_id = null; s.access_code = newCode(); return s.access_code;
  },
  renew_card: ({ p_student }) => { db.students.find((x) => x.id === p_student).card_token = uid(); },
  set_on_duty: ({ p_on }) => { if (!has("agent")) throw err("42501", "Réservé aux agents."); member().on_duty = p_on; },
  verify_card: ({ p_token }) => {
    if (!has("agent")) throw err("42501", "Réservé aux agents.");
    if (!member().on_duty) throw err("P0001", "Passez en service avant de contrôler.");
    const s = db.students.find((x) => x.card_token === p_token);
    const log = (student_id, allowed, reason) => db.checks.push({ id: uid(), agent_id: current.id, student_id, allowed, reason, checked_at: new Date().toISOString() });
    if (!s) { log(null, false, "Carte invalide"); return { allowed: false, reason: "Carte invalide ou révoquée" }; }
    const fees = feeStatusRows().filter((f) => f.student_id === s.id);
    const unpaid = fees.filter((f) => f.required_for_access && f.status === "impaye").map((f) => f.name);
    const partial = fees.some((f) => f.required_for_access && f.status === "acompte");
    const allowed = unpaid.length === 0;
    const reason = !allowed ? "Frais impayés : " + unpaid.join(", ") : partial ? "Autorisé (acompte versé)" : "Autorisé";
    log(s.id, allowed, reason);
    return { allowed, reason, matricule: s.matricule, first_name: s.first_name, last_name: s.last_name, level: s.level,
      fees: fees.map((f) => ({ name: f.name, due: f.amount_due, paid: f.paid, status: f.status })) };
  },
  resolve_alert: ({ p_alert }) => {
    const a = db.alerts.find((x) => x.id === p_alert && !x.resolved_at && (x.agent_id === current.id || has("admin")));
    if (!a) throw err("P0002", "Alerte introuvable.");
    a.resolved_at = new Date().toISOString();
  },
};

async function rpc(name, args) {
  await wait();
  if (!current) return { data: null, error: err("42501", "Connexion requise.") };
  try { return { data: RPC[name](args ?? {}) ?? null, error: null }; }
  catch (e) { return { data: null, error: e }; }
}

const emit = () => listeners.forEach((cb) => cb("CHANGE", current ? { user: current } : null));

export function createClient() {
  return {
    from: (table) => new Query(table),
    rpc,
    auth: {
      async getSession() { return { data: { session: current ? { user: current } : null }, error: null }; },
      async signUp({ email, password }) {
        if (db.users.find((u) => u.email === email)) return { data: null, error: { message: "User already registered" } };
        const u = { id: uid(), email, password };
        db.users.push(u);
        db.members.push({ user_id: u.id, email, full_name: null, role: null, on_duty: false, created_at: new Date().toISOString() });
        current = u; emit();
        return { data: { session: { user: u } }, error: null };
      },
      async signInWithPassword({ email, password }) {
        const u = db.users.find((x) => x.email === email && x.password === password);
        if (!u) return { data: null, error: { message: "Invalid login credentials" } };
        current = u; emit(); return { data: { session: { user: u } }, error: null };
      },
      async signOut() { current = null; emit(); return { error: null }; },
      onAuthStateChange(cb) { listeners.push(cb); },
    },
  };
}
