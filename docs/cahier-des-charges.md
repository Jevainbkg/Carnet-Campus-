# Cahier des charges — Carnet Campus

Version 1.0 · 23/10/2026 · Auteur : Jevain Bokwabgo Wisomi

> Projet **personnel** de démonstration de compétences, **pas un projet académique**. Inspiré de **CISNET 2025** et de mon projet de L2 « Universe Security ». Évolution de Carnet (gestion des notes).

## 1. Objectif

Réunir dans une application web unique ce qu'un établissement gère au quotidien autour d'un étudiant : ses **notes**, ses **frais** et son **accès au campus** par carte QR.

## 2. Utilisateurs et rôles

| Rôle | Obtention du rôle |
|---|---|
| Administrateur | Premier compte créé (installation), puis attribué par un administrateur |
| Enseignant, agent | Attribué par un administrateur depuis « Comptes » |
| Étudiant | Le compte saisit le code d'accès de sa fiche, remis par l'administration |

Un compte sans rôle ne voit que l'écran d'accueil (saisie du code, ou attente d'un rôle).

## 3. Exigences fonctionnelles

| ID | Exigence |
|---|---|
| F1 | L'admin inscrit, modifie et supprime des fiches étudiant (matricule unique, nom, prénom, niveau). |
| F2 | Chaque fiche a un code d'accès (XXXX-XXXX-XXXX) ; l'admin peut le régénérer, ce qui révoque l'accès du compte rattaché. |
| F3 | L'admin définit les types de frais (montant dû, exigé ou non pour l'accès) et enregistre ou annule des paiements. |
| F4 | Statut d'un frais : **payé** (payé ≥ dû), **acompte** (0 < payé < dû), **impayé** (0). |
| F5 | L'étudiant voit sa carte avec un QR code, l'état de ses frais et son relevé de notes, sans rien pouvoir modifier. |
| F6 | Le QR contient un jeton opaque ; l'admin peut renouveler la carte, l'ancien QR est alors refusé. |
| F7 | L'agent prend son service ; hors service, il ne peut pas contrôler. |
| F8 | L'agent scanne une carte (caméra) ou saisit son code ; il obtient un verdict : **autorisé**, **autorisé (acompte versé)**, **refusé : frais impayés (liste)** ou **refusé : carte invalide**. |
| F9 | Chaque contrôle est journalisé (agent, étudiant, verdict, date) ; l'agent voit les siens, l'admin tous. |
| F10 | L'agent crée des alertes (lieu, description) et résout les siennes ; l'admin voit et résout toutes les alertes. |
| F11 | L'enseignant crée ses matières (nom unique, coefficient 1 à 100) et saisit les notes (0 à 20, deux décimales, virgule acceptée). |
| F12 | Moyenne pondérée = somme(note × coef) ÷ somme des coefficients des matières notées ; une matière non notée ne compte pas comme 0. Affichage en /20 et en pourcentage. |
| F13 | Mode jour / nuit mémorisé ; relevé imprimable en PDF. |

## 4. Exigences non fonctionnelles

- **Sécurité** : RLS sur toutes les tables ; l'agent ne peut lister ni étudiants, ni paiements, ni notes ; aucun secret dans le dépôt ; CSP stricte.
- **Mobile d'abord** : utilisable à 375 px sans défilement horizontal (l'agent contrôle au téléphone).
- **Accessibilité** : libellés de formulaire, focus visible, messages d'erreur reliés aux champs, contrastes AA.
- **Fiabilité** : schéma SQL idempotent ; double soumission bloquée.
- **Données** : fictives uniquement.

## 5. Hors périmètre v1

Paiement en ligne, envoi d'e-mails ou de SMS, emplois du temps, import CSV, multi-établissement, photos de profil.

## 6. Critères d'acceptation

1. Un étudiant à jour est « autorisé », un étudiant avec acompte est « autorisé (acompte versé) », un étudiant sans paiement d'un frais exigé est « refusé », et chaque contrôle apparaît dans le journal.
2. Une carte renouvelée ou un jeton inconnu donne « carte invalide ».
3. Notes 10 (coef. 1) et 16 (coef. 2) : moyenne **14,00** et **70 %**.
4. Un étudiant ne voit que ses données ; un agent ne peut lister aucun étudiant ; un enseignant ne modifie pas la matière d'un autre.
5. Tous les tests passent (unitaires, base, interface).
