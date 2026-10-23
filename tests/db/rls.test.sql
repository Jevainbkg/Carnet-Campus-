-- Tests de la base : rôles, isolation, contrôle d'accès par carte, notes.
-- Chaque bloc lève une exception si le comportement attendu n'est pas observé.
\set ON_ERROR_STOP on
\o /dev/null

-- Comptes : 1 admin, 2 enseignant, 3 agent, 4 étudiant A, 5 étudiant B, 6 sans rôle, 7 second enseignant
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000001', 'admin@example.test'),
  ('00000000-0000-0000-0000-000000000002', 'prof@example.test'),
  ('00000000-0000-0000-0000-000000000003', 'agent@example.test'),
  ('00000000-0000-0000-0000-000000000004', 'etu.a@example.test'),
  ('00000000-0000-0000-0000-000000000005', 'etu.b@example.test'),
  ('00000000-0000-0000-0000-000000000006', 'curieux@example.test'),
  ('00000000-0000-0000-0000-000000000007', 'prof2@example.test');

create or replace function pg_temp.as_user(n int) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000' || n, false);
end $$;

set role authenticated;

-- ---------- Installation : le premier compte devient admin, pas le second ----------
select pg_temp.as_user(1);
do $$ begin
  if not claim_first_admin() then raise exception 'FAIL premier admin refusé'; end if;
  if my_role() <> 'admin' then raise exception 'FAIL rôle admin absent'; end if;
end $$;
select pg_temp.as_user(6);
do $$ begin
  if claim_first_admin() then raise exception 'FAIL second admin accepté'; end if;
  if my_role() is not null then raise exception 'FAIL compte sans rôle a un rôle'; end if;
  raise notice 'PASS premier compte = admin, les suivants restent sans rôle';
end $$;

-- Un compte sans rôle ne peut pas s'attribuer de rôle
do $$ begin
  begin perform set_member_role('00000000-0000-0000-0000-000000000006', 'admin');
    raise exception 'FAIL auto-promotion acceptée'; exception when insufficient_privilege then null; end;
  begin update members set role = 'admin' where user_id = auth.uid();
    raise exception 'FAIL update direct du rôle accepté'; exception when insufficient_privilege then null; end;
  raise notice 'PASS un compte ne peut pas changer son propre rôle';
end $$;

-- ---------- L'admin attribue les rôles et crée les données ----------
select pg_temp.as_user(1);
select set_member_role('00000000-0000-0000-0000-000000000002', 'enseignant');
select set_member_role('00000000-0000-0000-0000-000000000003', 'agent');
select set_member_role('00000000-0000-0000-0000-000000000007', 'enseignant');
do $$ begin
  begin perform set_member_role('00000000-0000-0000-0000-000000000001', null);
    raise exception 'FAIL l''admin se retire son rôle'; exception when raise_exception then null; end;
  raise notice 'PASS l''admin ne peut pas se retirer son propre rôle';
end $$;

insert into students (id, matricule, last_name, first_name, level) values
  ('10000000-0000-0000-0000-00000000000a', 'CC2026001', 'Demo', 'Alice', 'L2'),
  ('10000000-0000-0000-0000-00000000000b', 'CC2026002', 'Demo', 'Bruno', 'L2'),
  ('10000000-0000-0000-0000-00000000000c', 'CC2026003', 'Demo', 'Chloé', 'L1');
insert into payments (student_id, fee_type_id, amount)
  select '10000000-0000-0000-0000-00000000000a', id, amount_due from fee_types;              -- A : tout payé
insert into payments (student_id, fee_type_id, amount)
  select '10000000-0000-0000-0000-00000000000b', id, 300 from fee_types where name = 'Frais de scolarité'; -- B : acompte
-- C : rien payé

-- ---------- Rattachement des étudiants par code ----------
create temp table codes as select matricule, access_code, card_token from students;
grant select on codes to authenticated;
select pg_temp.as_user(4);
select claim_student((select access_code from codes where matricule = 'CC2026001'));
select pg_temp.as_user(5);
select claim_student((select access_code from codes where matricule = 'CC2026002'));
do $$ begin
  begin perform claim_student((select access_code from codes where matricule = 'CC2026001'));
    raise exception 'FAIL double rattachement accepté'; exception when raise_exception or no_data_found then null; end;
  if my_role() <> 'etudiant' then raise exception 'FAIL rôle étudiant non détecté'; end if;
  raise notice 'PASS rattachement par code, une fiche par compte';
end $$;
select pg_temp.as_user(2);
do $$ begin
  begin perform claim_student((select access_code from codes where matricule = 'CC2026003'));
    raise exception 'FAIL un enseignant devient étudiant'; exception when raise_exception then null; end;
  raise notice 'PASS un compte avec rôle ne peut pas réclamer une fiche';
end $$;

-- ---------- Étudiant A : ne voit que ses données ----------
select pg_temp.as_user(4);
do $$ declare n int; begin
  select count(*) into n from students; if n <> 1 then raise exception 'FAIL A voit % fiches', n; end if;
  select count(*) into n from payments; if n <> 2 then raise exception 'FAIL A voit % paiements', n; end if;
  select count(*) into n from fee_status where status <> 'paye'; if n <> 0 then raise exception 'FAIL statut frais A'; end if;
  select count(*) into n from members; if n <> 1 then raise exception 'FAIL A lit members (% lignes)', n; end if;
  select count(*) into n from checks; if n <> 0 then raise exception 'FAIL A lit les contrôles'; end if;
  select count(*) into n from alerts; if n <> 0 then raise exception 'FAIL A lit les alertes'; end if;
  begin insert into payments (student_id, fee_type_id, amount) select my_student_id(), id, 1 from fee_types limit 1;
    raise exception 'FAIL A s''ajoute un paiement'; exception when insufficient_privilege then null; end;
  update students set level = 'M2';
  get diagnostics n = row_count; if n <> 0 then raise exception 'FAIL A modifie sa fiche'; end if;
  begin perform verify_card((select card_token::text from codes where matricule = 'CC2026001'));
    raise exception 'FAIL un étudiant contrôle une carte'; exception when insufficient_privilege then null; end;
  raise notice 'PASS étudiant : lecture seule de ses propres données';
end $$;

-- ---------- Agent : ne lit aucune liste, contrôle seulement en service ----------
select pg_temp.as_user(3);
do $$ declare n int; r json; begin
  select count(*) into n from students; if n <> 0 then raise exception 'FAIL agent liste % étudiants', n; end if;
  select count(*) into n from payments; if n <> 0 then raise exception 'FAIL agent lit les paiements'; end if;
  select count(*) into n from grades; if n <> 0 then raise exception 'FAIL agent lit les notes'; end if;
  raise notice 'PASS agent : aucun accès aux listes d''étudiants, paiements ou notes';

  begin perform verify_card((select card_token::text from codes where matricule = 'CC2026001'));
    raise exception 'FAIL contrôle hors service accepté'; exception when raise_exception then null; end;
  perform set_on_duty(true);

  r := verify_card((select card_token::text from codes where matricule = 'CC2026001'));
  if not (r->>'allowed')::boolean or r->>'reason' <> 'Autorisé' then raise exception 'FAIL A devrait passer : %', r; end if;
  r := verify_card((select card_token::text from codes where matricule = 'CC2026002'));
  if not (r->>'allowed')::boolean or r->>'reason' <> 'Autorisé (acompte versé)' then raise exception 'FAIL B acompte : %', r; end if;
  r := verify_card((select card_token::text from codes where matricule = 'CC2026003'));
  if (r->>'allowed')::boolean or r->>'reason' <> 'Frais impayés : Frais de scolarité' then raise exception 'FAIL C impayé : %', r; end if;
  r := verify_card('pas-un-uuid');
  if (r->>'allowed')::boolean then raise exception 'FAIL jeton invalide accepté'; end if;
  r := verify_card(gen_random_uuid()::text);
  if (r->>'allowed')::boolean then raise exception 'FAIL jeton inconnu accepté'; end if;
  raise notice 'PASS verdicts : payé, acompte, impayé, carte invalide';

  select count(*) into n from checks; if n <> 5 then raise exception 'FAIL % contrôles journalisés au lieu de 5', n; end if;
  select count(*) into n from students; if n <> 0 then raise exception 'FAIL le scan ouvre la table students'; end if;
  begin insert into checks (agent_id, allowed, reason) values (auth.uid(), true, 'faux');
    raise exception 'FAIL contrôle inséré à la main'; exception when insufficient_privilege then null; end;
  raise notice 'PASS chaque contrôle est journalisé, pas de saisie manuelle';

  insert into alerts (place, description) values ('Portail B', 'Porte forcée');
  perform resolve_alert((select id from alerts limit 1));
  select count(*) into n from alerts where resolved_at is not null; if n <> 1 then raise exception 'FAIL alerte non résolue'; end if;
  raise notice 'PASS alertes : création et résolution par l''agent';
end $$;

-- ---------- Carte renouvelée : l'ancienne est refusée ----------
select pg_temp.as_user(1);
select renew_card('10000000-0000-0000-0000-00000000000a');
select pg_temp.as_user(3);
do $$ declare r json; begin
  r := verify_card((select card_token::text from codes where matricule = 'CC2026001'));
  if (r->>'allowed')::boolean then raise exception 'FAIL ancienne carte acceptée'; end if;
  raise notice 'PASS carte renouvelée : l''ancien QR est refusé';
end $$;

-- ---------- Enseignants : matières et notes ----------
select pg_temp.as_user(2);
insert into subjects (id, name, coefficient) values
  ('20000000-0000-0000-0000-000000000001', 'Mathématiques', 1),
  ('20000000-0000-0000-0000-000000000002', 'Physique', 2);
insert into grades (student_id, subject_id, value) values
  ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-000000000001', 10),
  ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-000000000002', 16);
do $$ declare n int; begin
  begin insert into grades (student_id, subject_id, value) values ('10000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-000000000001', 21);
    raise exception 'FAIL note 21 acceptée'; exception when check_violation then null; end;
  select count(*) into n from payments; if n <> 0 then raise exception 'FAIL enseignant lit les paiements'; end if;
  raise notice 'PASS enseignant : notes bornées 0-20, pas d''accès aux paiements';
end $$;

select pg_temp.as_user(7);
do $$ declare n int; begin
  insert into subjects (id, name, coefficient) values ('20000000-0000-0000-0000-000000000003', 'Anglais', 1);
  begin insert into grades (student_id, subject_id, value) values ('10000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-000000000001', 12);
    raise exception 'FAIL note dans la matière d''un autre'; exception when insufficient_privilege then null; end;
  update grades set value = 0; get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL modifie les notes d''un autre'; end if;
  update subjects set coefficient = 50 where id = '20000000-0000-0000-0000-000000000001'; get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL modifie la matière d''un autre'; end if;
  update subjects set teacher_id = '00000000-0000-0000-0000-000000000002' where id = '20000000-0000-0000-0000-000000000003';
  if (select teacher_id from subjects where id = '20000000-0000-0000-0000-000000000003') <> auth.uid() then raise exception 'FAIL transfert de matière'; end if;
  raise notice 'PASS enseignants isolés : chacun ses matières et ses notes';
end $$;

-- ---------- Étudiant A voit ses notes (moyenne 14), B ne voit pas celles de A ----------
select pg_temp.as_user(4);
do $$ declare avg numeric; begin
  select round(sum(g.value * s.coefficient) / sum(s.coefficient), 2) into avg from grades g join subjects s on s.id = g.subject_id;
  if avg <> 14 then raise exception 'FAIL moyenne A = %', avg; end if;
  begin update grades set value = 20; exception when insufficient_privilege then null; end;
  if (select max(value) from grades) <> 16 then raise exception 'FAIL A modifie ses notes'; end if;
  raise notice 'PASS étudiant : relevé lisible (moyenne 14,00), non modifiable';
end $$;
select pg_temp.as_user(5);
do $$ declare n int; begin
  select count(*) into n from grades; if n <> 0 then raise exception 'FAIL B voit les notes de A'; end if;
  raise notice 'PASS un étudiant ne voit pas les notes des autres';
end $$;

-- ---------- Révocation d'accès étudiant ----------
select pg_temp.as_user(1);
select reset_student_access('10000000-0000-0000-0000-00000000000a');
select pg_temp.as_user(4);
do $$ declare n int; begin
  select count(*) into n from students; if n <> 0 then raise exception 'FAIL accès conservé après révocation'; end if;
  select count(*) into n from grades; if n <> 0 then raise exception 'FAIL notes visibles après révocation'; end if;
  raise notice 'PASS révocation : l''ancien compte étudiant ne voit plus rien';
end $$;

-- ---------- Anonyme ----------
reset role;
set role anon;
do $$ begin
  begin perform 1 from students; raise exception 'FAIL anon lit students'; exception when insufficient_privilege then null; end;
  begin perform verify_card(gen_random_uuid()::text); raise exception 'FAIL anon contrôle'; exception when insufficient_privilege then null; end;
  raise notice 'PASS accès anonyme refusé';
end $$;
reset role;
