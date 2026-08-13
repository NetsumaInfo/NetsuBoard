## Ce qui change

<!-- Le problème, puis la solution. Si une issue existe : « Corrige #123 ». -->

## Pourquoi

<!-- Ce qui a motivé ce choix, et les compromis éventuels. -->

## Vérifications réellement effectuées

<!-- Cochez ce que vous avez VRAIMENT lancé. Une case cochée à tort coûte plus cher
     qu'une case vide : elle fait croire que la couche est couverte. -->

- [ ] `npm run build` (renderer, tsc strict)
- [ ] `npm run check:core` (backend `core/`)
- [ ] `npm run check:i18n` (textes et traductions)
- [ ] `node --test test/<suite>.test.cjs` (préciser lesquelles ci-dessous)
- [ ] `cargo check --locked` dans `src-tauri/` (si la coquille Rust est touchée)
- [ ] Testé en runtime dans l'application (`run.bat`)

## Ce qui n'a pas pu être testé

<!-- Soyez explicite. Certains chemins exigent un GPU compatible Vulkan, `yt-dlp`, ou une
     installation packagée — dire ce qui n'a pas tourné est aussi utile que dire ce qui a tourné.
     `node --test test/*.test.cjs` est ROUGE depuis la séparation d'avec NetsuRush : 23 suites en
     quarantaine (cf. `.github/workflows/ci.yml`). Un échec dans cette liste n'est pas votre PR. -->

## Captures

<!-- Obligatoire pour tout changement visuel. Une courte vidéo pour une interaction. -->

---

- [ ] Code, commits et titre de PR en anglais idiomatique ; interface et commentaires en français
- [ ] Une seule modification par PR (refactorisation et changement fonctionnel séparés)
- [ ] Toute nouvelle IPC est alignée aux 3 endroits (table `H` de `core/rpc.js`, `NrApi` + `coreClient.ts`, `mock` de `bridge.ts`)
- [ ] Toute dépendance runtime ajoutée met aussi à jour le packaging (`scripts/build.ps1`, `setup.ps1`, `test/packaging.test.cjs`)
