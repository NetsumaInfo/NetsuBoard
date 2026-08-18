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
