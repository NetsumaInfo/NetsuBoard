Ressources bundlées de NetsuBoard (générées au build).

scripts/build.ps1 stage ici, AVANT `tauri build` :
  bin/node.exe        node portable (sidecar du core, fetch-node.ps1)
  core/               service Node "core" (copie de ../../core)
  dist/               renderer buildé (copie de ../../dist)
  shaders/            shaders GLSL libplacebo (vendor/shaders ou fetch-shaders.ps1)
  scripts/setup.ps1   provisionnement du 1er lancement
  windows/            emplacement du runtime du lecteur natif — VIDE : voir docs/licensing.md

Aucun stage python/ : NetsuBoard n'embarque aucun sidecar ML.

Le stage est une liste FERMÉE : tout autre dossier trouvé ici est supprimé avant le bundle, car
tauri.conf.json embarque `resources/**/*` en entier.

Ne pas committer le contenu stagé (bin/core/dist/shaders/scripts/windows) — voir .gitignore.
Ce fichier sert d'ancre pour que le glob `resources/**/*` de tauri.conf.json matche en dev.
