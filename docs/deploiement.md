# Déploiement — Carnet Campus (Supabase + Vercel)

Méthode du skill /deploy (leçons D11 à D19). Légende : 👤 = toi · 🤖 = Claude.

## Étape 1 — Dépôt GitHub
1. 👤 **New repository** → `carnet-campus` → **Public** → ne coche rien → **Create**, puis envoie l'URL.
2. 🤖 Pousse le code et vérifie qu'aucun secret n'est publié.

## Étape 2 — Base Supabase
1. 👤 **New project** → nom `carnet-campus`, région proche, mot de passe généré par le bouton dédié (garde-le pour toi).
2. 👤 **SQL Editor → New query** → colle tout `supabase/schema.sql` → **Run**.
3. 👤 **Table Editor** : 8 tables avec le badge RLS (`members`, `students`, `fee_types`, `payments`, `subjects`, `grades`, `checks`, `alerts`). Vérification (D04) : `select * from fee_types;` renvoie 2 lignes.
4. 👤 **Project Settings → API Keys** : envoie la **Project URL** et la clé **publishable** (`sb_publishable_…`) (D14). Jamais la clé `secret` / `service_role`.

## Étape 3 — Configuration
1. 🤖 Renseigne `app/js/config.js`, ouvre une pull request ; 👤 la fusionne (D19 : la production ne suit que `main`).

## Étape 4 — Vercel
1. 👤 **Add New → Project** → importe `carnet-campus` → nom court, ex. `carnet-campus` (D18) → preset **Other**, racine `./` (D17) → **Deploy**.
2. 👤 Envoie l'URL obtenue.

## Étape 5 — Authentification
1. 👤 Supabase → **Authentication → URL Configuration** : *Site URL* = URL Vercel (remplace `localhost:3000`) ; *Redirect URLs* = `https://<site>/**` (D15).
2. 👤 Option démo : **Authentication → Providers → Email** → désactiver « Confirm email ».

## Étape 6 — Recette (porte de mise en ligne)
Créer 4 comptes avec 4 e-mails différents, dans cet ordre :

| # | Action | Attendu |
|---|---|---|
| 1 | Compte A → « Devenir administrateur » | Menu Étudiants, Comptes, Frais, Journal, Alertes |
| 2 | A inscrit Alice (paie 925 $) et Bruno (aucun paiement) | Alice « À jour », Bruno « Accès refusé » |
| 3 | Compte B, puis compte C : rester en attente ; A leur donne enseignant et agent | Rôle mis à jour |
| 4 | Compte D saisit le code d'Alice | Carte QR, frais « Payé » |
| 5 | B crée Maths (coef. 1) et Physique (coef. 2), note Alice 10 et 16 | D voit **14,00** et **70 %** |
| 6 | C prend son service et scanne la carte d'Alice au téléphone | **Accès autorisé**, visible dans le journal de A |
| 7 | A renouvelle la carte d'Alice ; C rescanne l'ancienne | **Carte invalide** |
| 8 | Mobile, mode nuit, rechargement de page, console | Lisible, session conservée, aucune erreur |

## Retour arrière
- Site : Vercel → *Deployments* → **Promote** le déploiement précédent.
- Base : `schema.sql` est idempotent et ne supprime aucune donnée.

## À savoir
- La caméra exige HTTPS (Vercel le fournit) et l'autorisation du navigateur ; la saisie manuelle du code de carte reste toujours disponible.
- Supabase Free se met en pause après environ 7 jours d'inactivité.
