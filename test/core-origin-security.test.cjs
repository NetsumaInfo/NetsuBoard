'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { controlRequestAllowed, rendererOriginAllowed } = require('../core/httpSecurity');

test('the loopback control plane accepts only native or loopback renderer origins', () => {
  assert.equal(controlRequestAllowed({ host: '127.0.0.1:8760', origin: 'http://localhost:1430' }), true);
  assert.equal(controlRequestAllowed({ host: 'localhost:8760', origin: 'tauri://localhost' }), true);
  assert.equal(controlRequestAllowed({ host: '127.0.0.1:8760' }), true);
  assert.equal(controlRequestAllowed({ host: 'evil.example:8760', origin: 'https://evil.example' }), false);
  assert.equal(controlRequestAllowed({ host: '127.0.0.1:8760', origin: 'https://evil.example' }), false);
  assert.equal(rendererOriginAllowed('null'), false);
});
