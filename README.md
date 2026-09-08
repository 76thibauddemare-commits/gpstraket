# GPS Traket

Application web (PWA) pour **enregistrer un tracé GPS**, **signaler des événements**
en cours de route, puis **exporter le parcours en GPX** et le **revisualiser sur une
carte interactive**.

## Fonctionnalités

- 🔴 **Bouton Record** : enregistre en continu ta position GPS et ton tracé.
- 🚩 **Gros bouton « Signaler un événement »** : d'un appui, enregistre l'heure et la
  position GPS d'un point qui ne fonctionne pas comme prévu.
- ⬇️ **Export GPX** : le fichier contient le tracé exact (`<trkpt>`) **et** les
  événements flagués (`<wpt>`), lisibles par n'importe quel outil GPX.
- 🗺️ **Carte interactive** : clique sur un enregistrement pour afficher le tracé
  parcouru sur une carte (Leaflet / OpenStreetMap) avec les événements au bon endroit.
- 📦 **100 % local** : tout est stocké sur ton appareil (IndexedDB). Aucun serveur,
  aucune donnée envoyée ailleurs.
- 📲 **Installable** : PWA — « Ajouter à l'écran d'accueil » sur mobile.

## Utilisation en local

Le GPS du navigateur exige un contexte sécurisé (`https://` ou `localhost`).

```bash
# Lance un petit serveur local
python3 -m http.server 8000
# puis ouvre http://localhost:8000
```

Sur téléphone, ouvre l'URL en **HTTPS** (ex. via GitHub Pages) puis autorise l'accès
à la localisation.

## Déploiement (GitHub Pages)

1. Repo → **Settings → Pages**
2. Source : branche voulue, dossier `/root`
3. L'app sera servie en HTTPS, prête à être installée sur ton téléphone.

## Comment ça marche

| Fichier | Rôle |
|---|---|
| `index.html` | Structure des 3 vues (enregistrement, liste, carte) |
| `styles.css` | Style mobile-first, thème sombre |
| `app.js` | GPS (`watchPosition`), stockage IndexedDB, génération GPX, carte Leaflet |
| `manifest.json` / `sw.js` | Installation PWA + fonctionnement hors-ligne |

### Notes techniques

- Points de tracé filtrés (précision > 50 m ou trop rapprochés) pour limiter le bruit.
- L'écran reste allumé pendant l'enregistrement (Wake Lock, si supporté).
- L'export utilise le **partage natif** sur mobile (`navigator.share`), sinon un
  téléchargement classique.
- Les tuiles de carte nécessitent une connexion internet ; le reste fonctionne
  hors-ligne une fois l'app chargée.
