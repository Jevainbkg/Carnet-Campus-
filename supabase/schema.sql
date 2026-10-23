-- =====================================================================
-- Carnet Campus — schéma Supabase (Postgres) : tables, rôles, RLS, fonctions.
-- À exécuter dans Supabase > SQL Editor. Idempotent : relançable sans perte.
--
-- Rôles : admin, enseignant, agent (table members) ; étudiant = compte
-- rattaché à une fiche students grâce à son code d'accès.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------
create table if not exists public.members (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  email      text not null,
  full_name  text check (full_name is null or char_length(btrim(full_name)) between 1 and 100),
  role       text check (role in ('admin', 'enseignant', 'agent')),
  on_duty    boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.students (
  id          uuid primary key default gen_random_uuid(),
  matricule   text not null unique check (char_length(btrim(matricule)) between 1 and 30),
  last_name   text not null check (char_length(btrim(last_name)) between 1 and 100),
  first_name  text not null check (char_length(btrim(first_name)) between 1 and 100),
  level       text not null default '' check (char_length(level) <= 50),
  user_id     uuid unique references auth.users (id) on delete set null,
  access_code text not null unique default upper(regexp_replace(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12), '(.{4})(.{4})(.{4})', '\1-\2-\3')),
  card_token  uuid not null unique default gen_random_uuid(),
  created_at  timestamptz not null default now()
);

create table if not exists public.fee_types (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null unique check (char_length(btrim(name)) between 1 and 100),
  amount_due          numeric(10, 2) not null check (amount_due > 0),
  required_for_access boolean not null default true
);

create table if not exists public.payments (
  id          uuid primary key default gen_random_uuid(),
  student_id  uuid not null references public.students (id) on delete cascade,
  fee_type_id uuid not null references public.fee_types (id) on delete restrict,
  amount      numeric(10, 2) not null check (amount > 0),
  paid_on     date not null default current_date,
  created_at  timestamptz not null default now()
);

create table if not exists public.subjects (
  id          uuid primary key default gen_random_uuid(),
  teacher_id  uuid not null default auth.uid() references public.members (user_id) on delete cascade,
  name        text not null unique check (char_length(btrim(name)) between 1 and 100),
  coefficient integer not null check (coefficient between 1 and 100)
);

create table if not exists public.grades (
  id         uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students (id) on delete cascade,
  subject_id uuid not null references public.subjects (id) on delete cascade,
  value      numeric(4, 2) not null check (value >= 0 and value <= 20),
  updated_at timestamptz not null default now(),
  constraint grades_student_subject_key unique (student_id, subject_id)
);

create table if not exists public.checks (
  id         uuid primary key default gen_random_uuid(),
  agent_id   uuid not null references public.members (user_id) on delete cascade,
  student_id uuid references public.students (id) on delete set null,
  allowed    boolean not null,
  reason     text not null,
  checked_at timestamptz not null default now()
);

create table if not exists public.alerts (
  id          uuid primary key default gen_random_uuid(),
  agent_id    uuid not null default auth.uid() references public.members (user_id) on delete cascade,
  place       text not null check (char_length(btrim(place)) between 1 and 100),
  description text not null check (char_length(btrim(description)) between 1 and 500),
  created_at  timestamptz not null default now(),
  resolved_at timestamptz
);

create index if not exists payments_student_idx on public.payments (student_id);
create index if not exists grades_subject_idx on public.grades (subject_id);
create index if not exists checks_agent_idx on public.checks (agent_id, checked_at desc);
create index if not exists alerts_created_idx on public.alerts (created_at desc);

-- ---------------------------------------------------------------------
-- Fonctions utilitaires (security definer : lisent members sans RLS)
-- ---------------------------------------------------------------------
create or replace function public.my_role()
returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    (select role from members where user_id = auth.uid()),
    case when exists (select 1 from students where user_id = auth.uid()) then 'etudiant' end
  )
$$;

create or replace function public.has_role(p_role text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from members where user_id = auth.uid() and role = p_role)
$$;

create or replace function public.my_student_id()
returns uuid language sql stable security definer set search_path = public as $$
  select id from students where user_id = auth.uid()
$$;

-- Chaque nouveau compte reçoit une ligne members sans rôle (en attente).
create or replace function public.on_auth_user_created()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into members (user_id, email) values (new.id, coalesce(new.email, '')) on conflict do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.on_auth_user_created();

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists grades_touch on public.grades;
create trigger grades_touch before update on public.grades
  for each row execute function public.touch_updated_at();

-- Une matière reste à son enseignant (seul l'admin peut la réattribuer).
create or replace function public.keep_teacher()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not has_role('admin') then new.teacher_id := old.teacher_id; end if;
  return new;
end $$;

drop trigger if exists subjects_keep_teacher on public.subjects;
create trigger subjects_keep_teacher before update on public.subjects
  for each row execute function public.keep_teacher();

-- ---------------------------------------------------------------------
-- Vue : état des frais par étudiant et par type (soumise à la RLS des tables)
-- ---------------------------------------------------------------------
create or replace view public.fee_status with (security_invoker = true) as
select s.id as student_id, f.id as fee_type_id, f.name, f.amount_due, f.required_for_access,
       coalesce(sum(p.amount), 0)::numeric(10, 2) as paid,
       case when coalesce(sum(p.amount), 0) >= f.amount_due then 'paye'
            when coalesce(sum(p.amount), 0) > 0 then 'acompte'
            else 'impaye' end as status
from public.students s
cross join public.fee_types f
left join public.payments p on p.student_id = s.id and p.fee_type_id = f.id
group by s.id, f.id;

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------
alter table public.members   enable row level security;
alter table public.students  enable row level security;
alter table public.fee_types enable row level security;
alter table public.payments  enable row level security;
alter table public.subjects  enable row level security;
alter table public.grades    enable row level security;
alter table public.checks    enable row level security;
alter table public.alerts    enable row level security;

revoke all on public.members, public.students, public.fee_types, public.payments,
  public.subjects, public.grades, public.checks, public.alerts, public.fee_status from anon, authenticated;

grant select on public.members, public.students, public.fee_types, public.payments,
  public.subjects, public.grades, public.checks, public.alerts, public.fee_status to authenticated;
grant update (full_name) on public.members to authenticated;
grant insert (id, matricule, last_name, first_name, level), update (matricule, last_name, first_name, level), delete on public.students to authenticated;
grant insert (id, name, amount_due, required_for_access), update (name, amount_due, required_for_access), delete on public.fee_types to authenticated;
grant insert (id, student_id, fee_type_id, amount, paid_on), delete on public.payments to authenticated;
grant insert (id, name, coefficient), update (name, coefficient, teacher_id), delete on public.subjects to authenticated;
grant insert (id, student_id, subject_id, value), update (value), delete on public.grades to authenticated;
grant insert (id, place, description) on public.alerts to authenticated;

-- members : chacun voit sa ligne ; l'admin voit tout. Le rôle se change via set_member_role().
drop policy if exists members_read on public.members;
create policy members_read on public.members for select to authenticated
  using (user_id = auth.uid() or has_role('admin'));
drop policy if exists members_update_self on public.members;
create policy members_update_self on public.members for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- students : admin (tout), enseignant (lecture), étudiant (sa fiche). L'agent : rien.
drop policy if exists students_read on public.students;
create policy students_read on public.students for select to authenticated
  using (has_role('admin') or has_role('enseignant') or user_id = auth.uid());
drop policy if exists students_admin on public.students;
create policy students_admin on public.students for all to authenticated
  using (has_role('admin')) with check (has_role('admin'));

-- fee_types : lecture pour tous les comptes, écriture admin.
drop policy if exists fee_types_read on public.fee_types;
create policy fee_types_read on public.fee_types for select to authenticated using (true);
drop policy if exists fee_types_admin on public.fee_types;
create policy fee_types_admin on public.fee_types for all to authenticated
  using (has_role('admin')) with check (has_role('admin'));

-- payments : admin (tout), étudiant (les siens).
drop policy if exists payments_read on public.payments;
create policy payments_read on public.payments for select to authenticated
  using (has_role('admin') or student_id = my_student_id());
drop policy if exists payments_admin on public.payments;
create policy payments_admin on public.payments for all to authenticated
  using (has_role('admin')) with check (has_role('admin'));

-- subjects : lecture pour admin, enseignants et étudiants ; écriture par l'enseignant propriétaire ou l'admin.
drop policy if exists subjects_read on public.subjects;
create policy subjects_read on public.subjects for select to authenticated
  using (has_role('admin') or has_role('enseignant') or my_student_id() is not null);
drop policy if exists subjects_write on public.subjects;
create policy subjects_write on public.subjects for all to authenticated
  using (has_role('admin') or (has_role('enseignant') and teacher_id = auth.uid()))
  with check (has_role('admin') or (has_role('enseignant') and teacher_id = auth.uid()));

-- grades : l'enseignant gère les notes de ses matières ; l'admin lit ; l'étudiant lit les siennes.
drop policy if exists grades_read on public.grades;
create policy grades_read on public.grades for select to authenticated
  using (
    has_role('admin') or student_id = my_student_id()
    or exists (select 1 from subjects m where m.id = subject_id and m.teacher_id = auth.uid())
  );
drop policy if exists grades_teacher on public.grades;
create policy grades_teacher on public.grades for all to authenticated
  using (has_role('enseignant') and exists (select 1 from subjects m where m.id = subject_id and m.teacher_id = auth.uid()))
  with check (has_role('enseignant') and exists (select 1 from subjects m where m.id = subject_id and m.teacher_id = auth.uid()));

-- checks : écrits uniquement par verify_card() ; l'agent lit les siens, l'admin tout.
drop policy if exists checks_read on public.checks;
create policy checks_read on public.checks for select to authenticated
  using (agent_id = auth.uid() or has_role('admin'));

-- alerts : agents et admin lisent ; un agent crée les siennes ; résolution via resolve_alert().
drop policy if exists alerts_read on public.alerts;
create policy alerts_read on public.alerts for select to authenticated
  using (has_role('agent') or has_role('admin'));
drop policy if exists alerts_insert on public.alerts;
create policy alerts_insert on public.alerts for insert to authenticated
  with check (has_role('agent') and agent_id = auth.uid());

-- ---------------------------------------------------------------------
-- Fonctions appelées par l'application (RPC)
-- ---------------------------------------------------------------------

-- Le tout premier compte devient administrateur (installation).
create or replace function public.claim_first_admin()
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Connexion requise.' using errcode = '42501'; end if;
  lock table members in share row exclusive mode;
  if exists (select 1 from members where role = 'admin') then return false; end if;
  if exists (select 1 from students where user_id = auth.uid()) then return false; end if;
  update members set role = 'admin' where user_id = auth.uid();
  return found;
end $$;

-- L'admin attribue (ou retire, avec null) un rôle. Il ne peut pas se retirer lui-même.
create or replace function public.set_member_role(p_user uuid, p_role text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not has_role('admin') then raise exception 'Réservé à l''administrateur.' using errcode = '42501'; end if;
  if p_user = auth.uid() then raise exception 'Vous ne pouvez pas modifier votre propre rôle.' using errcode = 'P0001'; end if;
  if p_role is not null and p_role not in ('admin', 'enseignant', 'agent') then
    raise exception 'Rôle inconnu.' using errcode = '22023';
  end if;
  if p_role is not null and exists (select 1 from students where user_id = p_user) then
    raise exception 'Ce compte est un compte étudiant.' using errcode = 'P0001';
  end if;
  update members set role = p_role, on_duty = case when p_role = 'agent' then on_duty else false end
    where user_id = p_user;
  if not found then raise exception 'Compte introuvable.' using errcode = 'P0002'; end if;
end $$;

-- Un compte sans rôle se rattache à sa fiche étudiant avec le code donné par l'administration.
create or replace function public.claim_student(p_code text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'Connexion requise.' using errcode = '42501'; end if;
  if exists (select 1 from members where user_id = auth.uid() and role is not null) then
    raise exception 'Ce compte a déjà un rôle : créez un compte séparé pour l''étudiant.' using errcode = 'P0001';
  end if;
  if exists (select 1 from students where user_id = auth.uid()) then
    raise exception 'Ce compte est déjà rattaché à une fiche.' using errcode = 'P0001';
  end if;
  update students set user_id = auth.uid()
    where access_code = upper(btrim(p_code)) and user_id is null
    returning id into v_id;
  if v_id is null then raise exception 'Code invalide ou déjà utilisé.' using errcode = 'P0002'; end if;
  return v_id;
end $$;

-- Admin : détache le compte étudiant et génère un nouveau code d'accès.
create or replace function public.reset_student_access(p_student uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_code text;
begin
  if not has_role('admin') then raise exception 'Réservé à l''administrateur.' using errcode = '42501'; end if;
  update students set user_id = null,
    access_code = upper(regexp_replace(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12), '(.{4})(.{4})(.{4})', '\1-\2-\3'))
    where id = p_student returning access_code into v_code;
  if v_code is null then raise exception 'Fiche introuvable.' using errcode = 'P0002'; end if;
  return v_code;
end $$;

-- Admin : rend la carte QR actuelle invalide (perte, vol).
create or replace function public.renew_card(p_student uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not has_role('admin') then raise exception 'Réservé à l''administrateur.' using errcode = '42501'; end if;
  update students set card_token = gen_random_uuid() where id = p_student;
  if not found then raise exception 'Fiche introuvable.' using errcode = 'P0002'; end if;
end $$;

-- Agent : prise / fin de service.
create or replace function public.set_on_duty(p_on boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not has_role('agent') then raise exception 'Réservé aux agents.' using errcode = '42501'; end if;
  update members set on_duty = p_on where user_id = auth.uid();
end $$;

-- Agent en service : vérifie une carte QR, journalise le contrôle et renvoie le verdict.
-- L'agent ne lit jamais la table students : il ne reçoit que la fiche scannée.
create or replace function public.verify_card(p_token text)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_token uuid;
  v_student students%rowtype;
  v_fees json;
  v_unpaid text;
  v_partial boolean;
  v_allowed boolean;
  v_reason text;
begin
  if not has_role('agent') then raise exception 'Réservé aux agents.' using errcode = '42501'; end if;
  if not (select on_duty from members where user_id = auth.uid()) then
    raise exception 'Passez en service avant de contrôler.' using errcode = 'P0001';
  end if;

  begin
    v_token := btrim(p_token)::uuid;
  exception when invalid_text_representation then
    v_token := null;
  end;
  if v_token is not null then
    select * into v_student from students where card_token = v_token;
  end if;

  if v_student.id is null then
    insert into checks (agent_id, student_id, allowed, reason) values (auth.uid(), null, false, 'Carte invalide');
    return json_build_object('allowed', false, 'reason', 'Carte invalide ou révoquée');
  end if;

  select json_agg(json_build_object('name', name, 'due', amount_due, 'paid', paid, 'status', status) order by name),
         string_agg(name, ', ' order by name) filter (where required_for_access and status = 'impaye'),
         bool_or(required_for_access and status = 'acompte')
    into v_fees, v_unpaid, v_partial
    from fee_status where student_id = v_student.id;

  v_allowed := v_unpaid is null;
  v_reason := case when not v_allowed then 'Frais impayés : ' || v_unpaid
                   when coalesce(v_partial, false) then 'Autorisé (acompte versé)'
                   else 'Autorisé' end;

  insert into checks (agent_id, student_id, allowed, reason) values (auth.uid(), v_student.id, v_allowed, v_reason);

  return json_build_object(
    'allowed', v_allowed, 'reason', v_reason,
    'matricule', v_student.matricule, 'first_name', v_student.first_name,
    'last_name', v_student.last_name, 'level', v_student.level,
    'fees', coalesce(v_fees, '[]'::json)
  );
end $$;

-- Agent : marque une alerte résolue (la sienne) ; l'admin peut résoudre toutes les alertes.
create or replace function public.resolve_alert(p_alert uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (has_role('agent') or has_role('admin')) then raise exception 'Accès refusé.' using errcode = '42501'; end if;
  update alerts set resolved_at = now()
    where id = p_alert and resolved_at is null and (agent_id = auth.uid() or has_role('admin'));
  if not found then raise exception 'Alerte introuvable, déjà résolue ou créée par un autre agent.' using errcode = 'P0002'; end if;
end $$;

revoke all on function public.my_role(), public.has_role(text), public.my_student_id(),
  public.claim_first_admin(), public.set_member_role(uuid, text), public.claim_student(text),
  public.reset_student_access(uuid), public.renew_card(uuid), public.set_on_duty(boolean),
  public.verify_card(text), public.resolve_alert(uuid), public.on_auth_user_created(), public.keep_teacher() from public, anon;
grant execute on function public.my_role(), public.has_role(text), public.my_student_id(),
  public.claim_first_admin(), public.set_member_role(uuid, text), public.claim_student(text),
  public.reset_student_access(uuid), public.renew_card(uuid), public.set_on_duty(boolean),
  public.verify_card(text), public.resolve_alert(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Données de départ : types de frais (fictifs, modifiables par l'admin)
-- ---------------------------------------------------------------------
insert into public.fee_types (name, amount_due, required_for_access) values
  ('Frais de scolarité', 925, true),
  ('Frais informatiques', 20, false)
on conflict (name) do nothing;
