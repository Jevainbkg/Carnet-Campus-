# Rapport de développement — Carnet Campus v1.0

23/10/2026 · Projet personnel de démonstration, inspiré de CISNET 2025

## 1. Point de départ

L'audit du projet de L2 (PHP 8 + MySQL) a relevé :
- **Sécurité** : mots de passe en clair, identifiants `root` dans `db.php`, protection par matricule dans l'URL, sorties non échappées, paiements de tous les étudiants envoyés au navigateur de l'agent.
- **Fonctionnement** : scan cassé (`$data` inexistant, recherche par index au lieu du matricule), `resolveAlert.php` absent, tables `controles` et `rondes` jamais alimentées.
- **Organisation** : six dumps SQL concurrents, fichiers de test et `.trashed-*` versionnés.

Décision : réécriture complète sur l'architecture validée par Carnet (site statique + Supabase), PHP abandonné.

## 2. Architecture

```
app/            site statique servi par Vercel
  js/app.js     routeur par hash, écrans des 4 rôles
  js/api.js     unique point d'accès à Supabase
  js/calc.js    règles métier pures (testées)
  js/qr.js      chargement à la demande des bibliothèques QR
  js/theme.js   mode jour / nuit
supabase/schema.sql   tables, vue fee_status, RLS, fonctions RPC
tests/          unitaires, base (Postgres local), interface (Playwright)
```

**Modèle de données** : `members` (rôle du personnel), `students` (fiche, code d'accès, jeton de carte), `fee_types`, `payments`, vue `fee_status`, `subjects`, `grades`, `checks` (journal), `alerts`.

**Fonctions RPC (security definer)** : `my_role`, `claim_first_admin`, `set_member_role`, `claim_student`, `reset_student_access`, `renew_card`, `set_on_duty`, `verify_card`, `resolve_alert`.

## 3. Choix de conception

| Choix | Raison |
|---|---|
| Le rôle affiché vient de `my_role()` (base) | Les métadonnées d'inscription sont modifiables par l'utilisateur (leçon D16) |
| Droits par colonne (`grant update (…)`) | Un étudiant ne peut pas modifier `user_id` ou `card_token`, même via l'API |
| `verify_card` renvoie une seule fiche et journalise | L'agent n'a aucune politique de lecture sur `students` ni `payments` |
| QR = `carnet-campus:<uuid>` | Opaque, révocable, ne révèle pas le matricule ; préfixe pour rejeter les QR étrangers |
| Accès refusé seulement si un frais **exigé** est impayé | Reprend la logique du L2 (acompte toléré) en la rendant paramétrable |
| Bibliothèques QR chargées à la demande | La page de connexion reste légère ; scanner chargé seulement chez l'agent |
| Premier compte = admin | Installation sans console SQL ; verrou de table contre la course |

## 4. Tests

| Suite | Résultat | Couvre |
|---|---|---|
| Unitaires (`node --test`) | **10/10** | Moyenne, pourcentages, statut des frais, montants, codes, QR, recherche, erreurs |
| Base (Postgres 16 + émulation Supabase) | **17/17** | Installation admin, anti auto-promotion, rattachement, isolation étudiant, agent sans listes, verdicts payé / acompte / impayé / invalide, journal non falsifiable, carte renouvelée, enseignants isolés, moyenne 14, révocation, anonyme |
| Interface (Playwright + faux Supabase) | **16/16** | Parcours complets des 4 rôles, validations, accès interdits, mode nuit, mobile 375 px sombre, zéro erreur JS |

## 5. Limites connues

- Le scan caméra n'est pas testé automatiquement (pas de caméra en CI) ; la saisie manuelle emprunte le même chemin (`verify_card`).
- Pas d'import CSV ni de pagination : prévu pour quelques centaines d'étudiants.
- La table `rondes` du L2 n'est pas reprise.

## 6. v1.1 — Retour au visuel du projet de L2

À la demande de l'auteur, l'interface reprend l'identité du projet d'origine « Universe Security » : fond blanc, Arial, bleu `#007bff`, cartes ombrées, icônes Font Awesome (servies localement, aucune ressource externe), connexion sur carte blanche avec champs soulignés, carte étudiant avec bannière, photo ronde (initiales) et badge rose du matricule, statut de service vert / rouge. Le moteur (Supabase, RLS, RPC) est inchangé. Tests : 10/10, 17/17, 16/16.
