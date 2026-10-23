# Prompt d'exécution (/reprompt) — Carnet Campus

**Rôle** : développeur full-stack web, sécurité d'abord.

**Contexte** : réécrire le projet de L2 « Universe Security » (PHP/MySQL, contrôle d'accès au campus par QR code) en projet personnel de démonstration, inspiré de CISNET 2025, et l'enrichir du gestionnaire de notes de Carnet pour en faire son évolution. Le code PHP sert de référence fonctionnelle uniquement.

**Objectif** : application web statique HTML/CSS/JS vanilla + Supabase (Auth, Postgres, RLS), déployable sur Vercel selon la méthode du skill /deploy.

**Périmètre** :
1. Rôles admin, enseignant, agent (table `members`) et étudiant (compte rattaché à une fiche par code d'accès). Le premier compte devient admin.
2. Étudiant : carte QR (jeton opaque révocable), frais avec statut payé / acompte / impayé, relevé de notes en lecture seule.
3. Agent : prise de service, scan caméra (html5-qrcode) ou saisie manuelle, verdict via `verify_card`, journal des contrôles, alertes.
4. Enseignant : ses matières et la saisie des notes.
5. Admin : étudiants, paiements, types de frais, rôles, renouvellement de carte, révocation d'accès, journal, alertes.

**Contraintes** : aucun secret dans le dépôt ; RLS sur chaque table ; l'agent ne lit jamais la liste des étudiants ; données fictives ; CSP stricte ; mobile d'abord ; mode jour / nuit ; français ; mention « projet personnel, pas académique, inspiré de CISNET 2025 ».

**Livrables** : `app/`, `supabase/schema.sql` idempotent, tests (unitaires, RLS sur Postgres local, interface Playwright avec faux client), cahier des charges, rapports de développement et de déploiement, captures.

**Critères d'acceptation** : voir la section 6 du [cahier des charges](cahier-des-charges.md).
