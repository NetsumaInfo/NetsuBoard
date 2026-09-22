// @ts-check
// Noms d'images (exécutables) des applications Adobe jointes par le panneau CEP — SOURCE UNIQUE.
// `adobe.js` s'en sert pour savoir si Premiere/After Effects tourne avant de sonder le panneau.

/** Exécutable principal de chaque hôte, par identifiant d'hôte (`activeHost` côté renderer). */
const HOST_IMAGES = {
  ppro: "Adobe Premiere Pro.exe",
  aeft: "AfterFX.exe",
};

/** Nom d'image sans extension, en minuscules — la forme comparable partout dans le core. */
function imageBase(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/\.exe$/i, "");
}

module.exports = {
  HOST_IMAGES,
  imageBase,
};
