# NetsuBoard — PRD

> Application de bureau autonome : un board de référence infini qui sait lire de la vidéo.
> Images, vidéos locales, YouTube, embeds, notes et dessin sur un canvas, plus un upscale GPU
> par shaders. Local, sans compte, sans environnement ML.

## 1. Vision

Une surface infinie où déposer tout ce qui sert de référence — y compris ce que les outils de
moodboard refusent : de la **vidéo qui se lit vraiment**, découpée sur la plage utile, en boucle, à
côté d'une image et d'une note.

Le pari : la référence vidéo mérite le même confort que la référence image. Un plan de trois
secondes dans un `.mkv` de 40 Go doit s'afficher, se rogner et boucler aussi simplement qu'une
capture collée.

### 1.1 Origine

NetsuBoard est **issu de [NetsuRush](https://github.com/NetsumaInfo/NetsuRush)**, hub de
post-production dont il reprend le board, le format `.netsu` et le moteur d'upscale par shaders. La
séparation n'est pas terminée : l'arbre porte encore des modules NetsuRush que l'application
n'atteint jamais. Ce PRD décrit le produit, pas l'arbre.

Les deux applications restent parentes — même mainteneur, et NetsuBoard télécharge son runtime
ffmpeg depuis un *release asset* du dépôt NetsuRush. **Le board est une seule fonctionnalité
présente dans deux dépôts** : quand il évolue d'un côté, le mainteneur reporte le changement de
l'autre côté à la main ; aucun code, sous-module ou job de synchronisation n'est partagé, donc rien
ne se propage tout seul. Pour le reste elles s'installent et tournent **côte à côte** : dépôt,
déploiement Convex, dossier de travail, ports et serveur de développement distincts. Aucune de ces
séparations n'est cosmétique.

## 2. Contraintes et faits techniques

- **Windows d'abord.** Lecteur natif libmpv et packaging NSIS sont Windows. macOS et Linux sont hors
  périmètre ; ne jamais promettre le cross-platform.
- **Coquille Tauri (Rust, WebView2) + service Node « core » local.** Le core écoute sur `127.0.0.1`,
  sur un port libre choisi au lancement par la coquille et transmis au renderer.
- **Le runtime tient en trois éléments** : ffmpeg/ffprobe, les shaders GLSL, `yt-dlp`. Provisionnés
  au premier lancement dans `%LOCALAPPDATA%\NetsuBoard`. **Aucun interpréteur Python, aucun venv,
  aucun poids de modèle.**
- **Le décodage vidéo est la ressource critique.** L'application vit à côté d'un logiciel gourmand :
  tout ce qui concurrence ce décodage (animation JS, fond animé, encodes non bornés) dégrade la
  tâche principale de l'utilisateur, pas seulement la nôtre.
- **WebView2 ne lit pas tout.** Pas de `.mkv` en `<video>`, pas de HLS natif. D'où `/media` (Range),
  `/stream` (remux à la volée) et le relais `/ytstream`.
- **L'upscale exige Vulkan** via `libplacebo`. Sans lui, l'upscale n'est pas proposé ; le reste de
  l'application n'exige aucun GPU.
- Matériel hétérogène assumé côté encodeurs : NVENC, AMF et Quick Sync sont sondés avec une vraie
  frame, repli CPU automatique. Aucun encodeur n'est codé en dur par marque.

## 3. Périmètre

**Canvas** — pan/zoom infini ; images, vidéos locales, YouTube, embeds web, notes texte, cadres
conteneurs, dessin à main levée (crayon, surligneur, formes, flèches, gomme) ; recadrage ; lecteur de
séquence ; inspecteur de style.

**Médias** — lecture locale via `/media` ou `/stream` selon le conteneur ; proxy mp4 pour une coupe
locale ; bornes in/out par élément, boucle et ping-pong ; images collées écrites sur disque et
adressées par contenu.

**En ligne** — YouTube relayé par `yt-dlp` et lu comme un fichier local, repli sur le lecteur
embarqué ; pages génériques exposant de l'OpenGraph ou une `<video>` HTML5, liées ou téléchargées.

**Projets** — scènes internes plus fichiers `.netsu` (conteneur SQLite, blobs adressés par contenu et
découpés, dossier compagnon `<projet>.medias/`), écriture incrémentale, grille « Récent » unique.

**Fenêtre détachée** — seconde fenêtre Tauri frameless toujours au-dessus, board nu, toutes les
actions au menu contextuel ; épinglage en place équivalent sans seconde fenêtre.

**Upscale Turbo** — shaders GLSL exécutés par ffmpeg `libplacebo` : ArtCNN et Anime4K pour
l'animation, `lanczossharp` pour le réel.

**Apparence** — palettes livrées, thèmes personnalisés, fonds d'écran image/GIF/vidéo avec recadrage,
flou et translucidité, thème « Contraste élevé ».

**Langues** — fr, en, es, de, ja, zh. Le français est la langue source du texte.

## 4. Architecture

Voir `docs/architecture.md` pour le détail. En résumé : la coquille Rust ouvre la fenêtre et lance le
core Node ; le core sert les médias, relaie YouTube, pilote ffmpeg et persiste scènes et projets ; le
renderer React parle au core par un seul point de contact (`src/lib/bridge.ts`), avec un mock qui
laisse l'interface se rendre dans un navigateur nu.

Tout nouveau canal IPC s'ajoute **en trois endroits** : `core/rpc.js`, `src/lib/coreClient.ts`,
`src/lib/bridge.ts`.

## 5. Invariants produit

Détail et justification dans `docs/invariants.md`. Les trois qui priment :

1. **Le locator persisté n'est jamais l'URL d'affichage.** `ref` survit au redémarrage, `src` est
   recalculé au chargement.
2. **Une coupe locale se lit comme un proxy**, jamais comme le fichier brut : le seek en milieu de
   fichier échoue sur une copie de flux et l'utilisateur voit le mauvais média.
3. **Le décodage vidéo prime** : aucune animation JavaScript sur le board, aucun fond animé pendant
   un travail lourd, aucun `<video>` maintenu monté hors écran.

## 6. Hors périmètre

- **Tout moteur d'upscale IA.** L'upscale reste des shaders : c'est la promesse « pas d'environnement
  ML », pas une étape vers un moteur neuronal.
- **Tout pilotage d'un logiciel de montage.** Le pont Resolve, les ponts Adobe et le transfert de
  timeline appartiennent à NetsuRush.
- **Tout backend de partage ou de collaboration.** Un projet est un fichier ; le partage est un
  fichier.
- **Tout compte obligatoire.** La connexion Discord existe, mais elle est facultative et traversable :
  sans `VITE_CONVEX_URL`, hors ligne avec un login de moins de 7 jours, ou après un « Passer », le
  board s'ouvre. Elle sert à nommer un testeur sur un rapport de bug, jamais à déverrouiller l'app.
- **macOS et Linux.**

## 7. Risques

| Risque | Impact | Réponse |
|---|---|---|
| Séparation NetsuRush inachevée | code mort, suite de tests rouge, confusion des contributeurs | purge par lots, documentée ; le périmètre réel du produit est la table RPC |
| Collisions entre les deux applications | caches et ports partagés, une app en écrase une autre | `NR_HOME` et ports déjà séparés ; les violations restantes sont listées dans `docs/invariants.md` |
| YouTube casse la résolution de flux | les éléments en ligne deviennent morts | `yt-dlp` mis à jour, repli sur le lecteur embarqué, relais qui renouvelle l'URL sur 403 |
| ffmpeg sans `libplacebo` ou Vulkan absent | upscale indisponible | version épinglée, build `master` interdite, sonde avant de proposer un shader |
| `gallery-dl` attendu dans un venv absent | extraction d'images de posts sociaux morte | à trancher : route `yt-dlp` seule, ou exécutable autonome ajouté au setup |
| Décodage vidéo saturé par l'interface | l'application nuit au logiciel d'à côté | règles de performance non négociables, gel des fonds pendant le travail |

## 8. Stack

- **Renderer** : React 19, TypeScript strict, Vite 7, Tailwind 4, shadcn/ui en saveur Base UI,
  zustand, i18next.
- **Core** : Node 22 (CommonJS), HTTP/SSE, `node:sqlite`, ffmpeg/ffprobe, `yt-dlp`.
- **Coquille** : Rust / Tauri 2, WebView2, libmpv pour le lecteur natif, installeur NSIS `currentUser`.
- **Qualité** : `tsc` sert de lint (pas d'ESLint, pas de formateur), `node --test`, parité i18n par
  script, `cargo check`.
