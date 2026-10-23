# Rapport de déploiement — Carnet Campus

**Statut** : ⏳ en préparation · **Dernière mise à jour** : 23/10/2026

> Procédure pas à pas : [deploiement.md](deploiement.md).

## 1. Cible
| Élément | Service | Offre | URL |
|---|---|---|---|
| Code source | GitHub (public) | Gratuit | [À COMPLÉTER] |
| Base + authentification | Supabase | Free | [À COMPLÉTER] |
| Site | Vercel | Hobby (personnel, non commercial) | [À COMPLÉTER] |

## 2. Contrôles avant déploiement
| Contrôle | Résultat |
|---|---|
| Tests unitaires | ✅ 10/10 |
| Tests base (RLS) | ✅ 17/17 |
| Tests interface | ✅ 16/16 |
| Aucun secret dans le dépôt | ✅ |
| `schema.sql` idempotent (exécuté deux fois de suite) | ✅ |
| CSP, `Permissions-Policy: camera=(self)` | ✅ |

## 3. Journal des étapes
| # | Étape | Statut | Date | Remarques |
|---|---|---|---|---|
| 1 | Dépôt GitHub créé et code poussé | ⏳ | | |
| 2 | Projet Supabase, `schema.sql` exécuté | ⏳ | | |
| 3 | `config.js` renseigné (PR fusionnée) | ⏳ | | |
| 4 | Vercel importé et déployé | ⏳ | | |
| 5 | Site URL et Redirect URLs Supabase | ⏳ | | |
| 6 | Recette en ligne (8 points) | ⏳ | | |

## 4. Retour arrière
Vercel → *Promote* le déploiement précédent ; `schema.sql` relançable sans perte.
