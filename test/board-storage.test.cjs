// Paramètres › Stockage : ce module décide de SUPPRESSIONS. Un faux négatif coûte quelques
// mégaoctets gardés pour rien ; un faux positif détruit le travail de quelqu'un. Les tests portent
// donc surtout sur ce que le module refuse de libérer.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'netsu-storage-'));
process.env.NR_HOME = home;
const { createReferenceStore } = require('../core/reference');
const { createBoardStorage } = require('../core/boardStorage');
const netsu = require('../core/netsu');
const recents = require('../core/netsu/recents');

test.after(() => netsu.closeAllProjects());

/** Un asset du magasin, nommé par son md5 comme le fait reference.js#saveAsset. */
function writeAsset(refStore, bytes) {
  const buffer = Buffer.from(bytes);
  const saved = refStore.saveAsset(buffer, 'png');
  assert.equal(saved.ok, true);
  // Le nettoyage ignore ce qui vient d'être écrit (import peut-être en cours) : on vieillit le
  // fichier pour tester la classification, pas la temporisation.
  const old = Date.now() - 60 * 60 * 1000;
  fs.utimesSync(saved.path, new Date(old), new Date(old));
  return saved.path;
}

/** Le double tel que l'adoption l'écrirait : `<lisible>-<md5 sur 12>.<ext>` dans `<projet>.medias`. */
function placeCopy(projectPath, assetFile, bytes) {
  const md5 = path.basename(assetFile, path.extname(assetFile));
  const dir = path.join(path.dirname(projectPath), `${path.basename(projectPath, '.netsu')}.medias`, 'images');
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, `visuel-${md5.slice(0, 12)}.png`);
  fs.writeFileSync(dest, Buffer.from(bytes));
  return dest;
}

function fresh(name) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `netsu-storage-${name}-`));
  const refStore = createReferenceStore(root);
  return { root, refStore, storage: createBoardStorage({ refStore, netsu }) };
}

test('an asset a board still shows is never freeable, even with a copy in a project', async () => {
  const { root, refStore, storage } = fresh('held');
  const bytes = crypto.randomBytes(2048);
  const asset = writeAsset(refStore, bytes);
  refStore.saveScene({ name: 'Mon board', items: [{ id: 'a', kind: 'image', ref: asset }], view: null });

  const projectPath = path.join(root, 'Projet.netsu');
  fs.writeFileSync(projectPath, '');
  placeCopy(projectPath, asset, bytes);
  recents.remember({ path: projectPath, title: 'Projet', type: 'board' });

  const audit = await storage.audit({});
  assert.equal(audit.ok, true);
  assert.equal(audit.assets.freeable.files, 0);
  assert.equal(audit.assets.orphans.files, 0);
  assert.equal(audit.assets.held.files, 1);

  await storage.free({ assets: true });
  assert.equal(fs.existsSync(asset), true);
});

test('an unreferenced asset whose bytes are in a project is freed, and only it', async () => {
  const { root, refStore, storage } = fresh('dup');
  const copied = crypto.randomBytes(4096);
  const alone = crypto.randomBytes(3072);
  const duplicated = writeAsset(refStore, copied);
  const orphan = writeAsset(refStore, alone);

  const projectPath = path.join(root, 'Projet.netsu');
  fs.writeFileSync(projectPath, '');
  placeCopy(projectPath, duplicated, copied);
  recents.remember({ path: projectPath, title: 'Projet', type: 'board' });

  const audit = await storage.audit({});
  assert.equal(audit.assets.freeable.files, 1);
  assert.equal(audit.assets.freeable.entries[0].project, projectPath);
  assert.equal(audit.assets.orphans.files, 1);

  const freed = await storage.free({ assets: true });
  assert.equal(freed.ok, true);
  assert.equal(freed.files, 1);
  assert.equal(fs.existsSync(duplicated), false);
  assert.equal(fs.existsSync(orphan), true); // copie unique : jamais emportée par « Libérer »
});

test('a copy of a different size does not count as a copy', async () => {
  const { root, refStore, storage } = fresh('truncated');
  const bytes = crypto.randomBytes(4096);
  const asset = writeAsset(refStore, bytes);

  const projectPath = path.join(root, 'Projet.netsu');
  fs.writeFileSync(projectPath, '');
  // Écriture interrompue : le nom promet le bon contenu, la taille dit le contraire.
  placeCopy(projectPath, asset, bytes.subarray(0, 100));
  recents.remember({ path: projectPath, title: 'Projet', type: 'board' });

  const audit = await storage.audit({});
  assert.equal(audit.assets.freeable.files, 0);
  assert.equal(audit.assets.orphans.files, 1);
});

test('the media of a shared board is held by its locator list, not by items', async () => {
  const { refStore, storage } = fresh('collab');
  const asset = writeAsset(refStore, crypto.randomBytes(1024));
  // Une scène collaborative ne garde AUCUN item : sans la liste `media`, son média passerait pour
  // un orphelin et « Libérer » l'emporterait.
  refStore.saveScene({
    name: 'Board partagé',
    items: [],
    view: null,
    collaboration: { projectId: 'p1' },
    media: [asset],
  });

  const audit = await storage.audit({});
  assert.equal(audit.assets.orphans.files, 0);
  assert.equal(audit.assets.held.files, 1);
  const [scene] = audit.assets.held.scenes;
  assert.equal(scene.collaborative, true);
  assert.equal(scene.soleFiles, 1);

  await storage.free({ assets: true });
  assert.equal(fs.existsSync(asset), true);
});

test('a board media placed but never saved survives through the live locator list', async () => {
  const { refStore, storage } = fresh('live');
  const asset = writeAsset(refStore, crypto.randomBytes(1024));

  const blind = await storage.audit({});
  assert.equal(blind.assets.orphans.files, 1); // aucune scène ne le mentionne encore

  const aware = await storage.audit({ liveRefs: [asset] });
  assert.equal(aware.assets.orphans.files, 0);
  assert.equal(aware.assets.held.files, 1);

  await storage.free({ assets: true, liveRefs: [asset] });
  assert.equal(fs.existsSync(asset), true);
});

test('moving orphans out empties the store and never touches a held asset', async () => {
  const { root, refStore, storage } = fresh('move');
  const orphan = writeAsset(refStore, crypto.randomBytes(2048));
  const used = writeAsset(refStore, crypto.randomBytes(2048));
  refStore.saveScene({ name: 'Board', items: [{ id: 'a', kind: 'image', ref: used }], view: null });

  const dest = path.join(root, 'sortie');
  fs.mkdirSync(dest);
  const moved = await storage.moveOrphans({ destDir: dest });
  assert.equal(moved.ok, true);
  assert.equal(moved.files, 1);
  assert.equal(fs.existsSync(orphan), false);
  assert.equal(fs.existsSync(used), true);
  assert.equal(fs.readdirSync(dest).length, 1);
});

test('orphans are never moved into the store itself', async () => {
  const { refStore, storage } = fresh('move-self');
  const orphan = writeAsset(refStore, crypto.randomBytes(512));
  const refused = await storage.moveOrphans({ destDir: refStore.assetsDir });
  assert.equal(refused.ok, false);
  assert.equal(fs.existsSync(orphan), true);
});

test('archiving a scene files its media into the project and frees the store copy', async () => {
  const { root, refStore, storage } = fresh('archive');
  const asset = writeAsset(refStore, crypto.randomBytes(4096));
  const scene = refStore.saveScene({
    name: 'À archiver',
    items: [{ id: 'a', kind: 'image', ref: asset, x: 0, y: 0, w: 10, h: 10 }],
    view: null,
  });

  const destPath = path.join(root, 'Archive.netsu');
  const saved = await storage.archiveScene({ sceneId: scene.id, destPath });
  assert.equal(saved.ok, true);
  // L'enregistrement adopte SANS CONDITION un asset possédé par l'app : ses octets sont maintenant
  // dans le dossier compagnon, et la scène interne a disparu.
  const sidecarDir = path.join(root, 'Archive.medias');
  assert.equal(fs.existsSync(sidecarDir), true);
  assert.equal(refStore.loadScene(scene.id), null);

  const audit = await storage.audit({});
  assert.equal(audit.assets.freeable.files, 1);
  assert.equal(audit.assets.held.files, 0);
});

test('a dead path whose name carries the fingerprint is relocated to the asset store', async () => {
  const { root, refStore, storage } = fresh('locate-store');
  const bytes = crypto.randomBytes(2048);
  const asset = writeAsset(refStore, bytes);
  const md5 = path.basename(asset, path.extname(asset));
  // Le chemin mort d'un dossier compagnon disparu : nom rangé `<lisible>-<md5 sur 12>`.
  const dead = path.join(root, 'disparu.medias', 'images', `visuel-${md5.slice(0, 12)}.png`);

  const result = await storage.locateMedia({ refs: [dead, 'https://a.example/x.png', 'sidecar:images/x.png'] });
  assert.equal(result.ok, true);
  assert.equal(result.moves[dead], asset);
  assert.equal(Object.keys(result.moves).length, 1);
  assert.deepEqual(result.dead, []);
});

test('a missing path nobody holds is reported dead, hashed name or not', async () => {
  const { root, storage } = fresh('locate-dead');
  const hashed = path.join(root, 'gone.medias', 'videos', 'clip-0123456789ab.mp4');
  const plain = path.join(root, 'rushes', 'plan final.mp4');
  const result = await storage.locateMedia({ refs: [hashed, plain] });
  assert.deepEqual(Object.keys(result.moves), []);
  assert.deepEqual([...result.dead].sort(), [hashed, plain].sort());
});

test('a dead path is relocated to a known project companion when the store lost its copy', async () => {
  const { root, refStore, storage } = fresh('locate-project');
  const bytes = crypto.randomBytes(2048);
  const asset = writeAsset(refStore, bytes);
  const md5 = path.basename(asset, path.extname(asset));
  const projectPath = path.join(root, 'Projet.netsu');
  fs.writeFileSync(projectPath, '');
  const copy = placeCopy(projectPath, asset, bytes);
  recents.remember({ path: projectPath, title: 'Projet', type: 'board' });
  fs.rmSync(asset); // le magasin n'a plus les octets : seul le compagnon du projet les garde

  const dead = path.join(root, 'ailleurs.medias', 'images', `visuel-${md5.slice(0, 12)}.png`);
  const result = await storage.locateMedia({ refs: [dead] });
  assert.equal(result.moves[dead], copy);
});

test('the open project companion wins, and a living path is never moved', async () => {
  const { root, refStore, storage } = fresh('locate-open');
  const bytes = crypto.randomBytes(1024);
  const asset = writeAsset(refStore, bytes);
  const md5 = path.basename(asset, path.extname(asset));
  const projectPath = path.join(root, 'Ouvert.netsu');
  fs.writeFileSync(projectPath, '');
  const copy = placeCopy(projectPath, asset, bytes);

  const dead = path.join(root, 'vieux.medias', 'images', `visuel-${md5.slice(0, 12)}.png`);
  const located = await storage.locateMedia({ refs: [dead, asset], projectPath });
  // Le compagnon du projet ouvert passe avant le magasin ; l'asset existant n'apparaît pas.
  assert.equal(located.moves[dead], copy);
  assert.equal(located.moves[asset], undefined);
});

test('a shared board is refused as a project archive', async () => {
  const { root, refStore, storage } = fresh('archive-collab');
  const scene = refStore.saveScene({
    name: 'Partagé',
    items: [],
    view: null,
    collaboration: { projectId: 'p1' },
  });
  const refused = await storage.archiveScene({ sceneId: scene.id, destPath: path.join(root, 'x.netsu') });
  assert.equal(refused.ok, false);
  assert.notEqual(refStore.loadScene(scene.id), null);
});
