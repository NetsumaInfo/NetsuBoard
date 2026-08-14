// Two rules of the still-image path, both checkable without a GPU or ffmpeg.
//
// 1. No `-ss 0`. On the image2 demuxer a still frame lasts 0.04 s, and an input seek to 0 eats the
//    only frame: ffmpeg prints "No filtered frames for output stream", writes NO file and still
//    exits 0. The caller took that for a success and the board pointed at a file that never existed
//    — the broken-image icon on every image upscale.
// 2. Alpha survives. libplacebo drops the alpha channel whatever `format=` asks for, so a
//    transparent source goes through a split graph: colour to the shader, alpha scaled beside it,
//    both merged back.
const test = require('node:test');
const assert = require('node:assert/strict');
const shaderUpscale = require('../core/shaderUpscale.js');

const { frameArgs, hasAlpha, alphaGraph } = shaderUpscale;

test('une image fixe est lue sans seek d\'entrée', () => {
  const args = frameArgs('in.png', 0, 'out.png', 'libplacebo=w=2:h=2');
  assert.equal(args.includes('-ss'), false);
  assert.deepEqual(args.slice(-9), ['-vf', 'libplacebo=w=2:h=2', '-frames:v', '1', '-update', '1', '-f', 'image2', 'out.png']);
});

test('une frame de vidéo garde son seek', () => {
  const args = frameArgs('in.mp4', 4.5, 'out.png', null);
  assert.equal(args[args.indexOf('-ss') + 1], '4.5');
  assert.ok(args.indexOf('-ss') < args.indexOf('-i')); // seek d'entrée : rapide, avant le décodage
});

test('le graphe alpha passe par -filter_complex et mappe sa sortie', () => {
  const args = frameArgs('in.png', 0, 'out.png', null, alphaGraph('libplacebo=w=4:h=4', 4, 4));
  assert.ok(args.includes('-filter_complex'));
  assert.deepEqual([args[args.indexOf('-map') + 1]], ['[out]']);
  assert.equal(args.includes('-vf'), false);
});

test('les formats à canal alpha sont reconnus', () => {
  for (const pix of ['rgba', 'bgra', 'argb', 'yuva420p', 'ya8', 'gbrap', 'pal8']) {
    assert.equal(hasAlpha(pix), true, pix);
  }
  for (const pix of ['yuv420p', 'yuvj444p', 'rgb24', 'gray', '', null]) {
    assert.equal(hasAlpha(pix), false, String(pix));
  }
});

test('le shader ne voit que la couleur, l\'alpha est agrandi à part puis recollé', () => {
  const g = alphaGraph('libplacebo=w=512:h=512:format=yuv444p', 512, 512);
  const [colour, alpha] = [g.slice(g.indexOf('[c]'), g.indexOf('[a]alphaextract')), g.slice(g.indexOf('[a]alphaextract'))];
  assert.match(colour, /libplacebo/);
  assert.equal(/libplacebo/.test(alpha), false); // l'alpha ne passe PAS dans le réseau
  assert.match(alpha, /alphaextract,scale=512:512/);
  assert.match(g, /alphamerge,format=rgba\[out\]$/);
});
