'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createReferenceStore } = require('../core/reference');

test('scene metadata preserves its collaborative project binding', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nb-collab-scene-'));
  let store;
  try {
    store = createReferenceStore(root);
    const saved = store.saveScene({
      name: 'Shared board',
      items: [],
      view: null,
      collaboration: { projectId: 'project_123' },
    });
    assert.equal(saved.ok, true);
    assert.deepEqual(store.loadScene(saved.id).collaboration, { projectId: 'project_123' });
    assert.deepEqual(store.listScenes()[0].collaboration, { projectId: 'project_123' });
  } finally {
    store?.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// A collaborative scene stores no items, and the shell authorises a local file import against the
// STORED scene. Without the locator list beside them, no media can ever enter a shared board.
test('a collaborative scene keeps its media locators although it keeps no items', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nb-collab-media-'));
  let store;
  try {
    store = createReferenceStore(root);
    const saved = store.saveScene({
      name: 'Shared board',
      items: [],
      view: null,
      collaboration: { projectId: 'project_123' },
      media: ['C:/clips/reel.mp4', 'C:/clips/cover.png'],
      preview: [
        { id: 'a', kind: 'image', x: 0, y: 0, w: 100, h: 80, z: 0, rotation: 0, ref: 'C:/clips/cover.png' },
        { id: 'b', kind: 'video', x: 120, y: 0, w: 100, h: 80, z: 1, rotation: 0, ref: 'https://cdn.example/a.mp4' },
      ],
    });
    const reloaded = store.loadScene(saved.id);
    assert.deepEqual(reloaded.items, []);
    assert.deepEqual(reloaded.media, ['C:/clips/reel.mp4', 'C:/clips/cover.png']);
    // L'aperçu porte la DISPOSITION, jamais un chemin disque : la vignette n'a pas besoin de savoir
    // où vivent les octets, et un board partagé ne doit pas semer les chemins de son auteur.
    assert.equal(reloaded.preview.length, 2);
    assert.equal(reloaded.preview[0].ref, undefined);
    assert.equal(reloaded.preview[1].ref, 'https://cdn.example/a.mp4');
    assert.deepEqual(
      { x: reloaded.preview[1].x, w: reloaded.preview[1].w, z: reloaded.preview[1].z },
      { x: 120, w: 100, z: 1 },
    );

    const bare = store.saveScene({ name: 'Solo board', items: [], view: null });
    assert.deepEqual(store.loadScene(bare.id).media, []);
    assert.deepEqual(store.loadScene(bare.id).preview, []);
  } finally {
    store?.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
