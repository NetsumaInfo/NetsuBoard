// @ts-check
// core/diskUsage.js
// Mesures disque partagées par Paramètres › Stockage (cacheAdmin) et le magasin du board
// (boardStorage) : espace du volume, et taille récursive d'un dossier de cache.

const path = require("path");
const fs = require("fs");
const { yieldLoop } = require("./config");

const fsp = fs.promises;

// Espace libre/total du volume contenant `p`. Renvoie null si statfs indisponible (vieux Node).
async function diskInfo(p) {
  try {
    if (!fsp.statfs) return null;
    const st = await fsp.statfs(p);
    const total = st.blocks * st.bsize;
    const free = st.bavail * st.bsize;
    return { total, free, used: total - free };
  } catch {
    return null;
  }
}

// Taille récursive d'un dossier (octets). Borne la profondeur et rend la main périodiquement pour ne
// pas affamer l'event loop sur un gros cache. Erreurs d'accès ignorées (fichiers verrouillés).
async function dirSize(root, depth = 6) {
  let total = 0;
  let n = 0;
  async function walk(dir, d) {
    /** @type {fs.Dirent[]} */
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (d > 0) await walk(full, d - 1);
      } else {
        try {
          total += (await fsp.stat(full)).size;
        } catch {}
      }
      if (++n % 200 === 0) await yieldLoop();
    }
  }
  await walk(root, depth);
  return total;
}

module.exports = { diskInfo, dirSize };
