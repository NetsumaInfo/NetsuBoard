// A looping export is one ffmpeg command: what it asks of ffmpeg is checked here without running it.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loopArgs, loopFilters, exportLoop, MAX_LOOP_SEC } = require('../core/loopExport.js');

test('filters follow the board: crop, mirror, cadence, then a width that never enlarges', () => {
  const chain = loopFilters({ crop: { x: 0.25, y: 0, w: 0.5, h: 1 }, flipH: true, fps: 24, width: 720 });
  assert.deepEqual(chain, [
    'crop=iw*0.500000:ih*1.000000:iw*0.250000:ih*0.000000',
    'hflip',
    'fps=24.000',
    "scale='min(720,iw)':-2:flags=lanczos",
  ]);
  assert.deepEqual(loopFilters({}), []);
});

test('WebP is animated, lossy at the asked quality, and loops forever', () => {
  const args = loopArgs({ input: 'a.mp4', out: 'b.webp.part', format: 'webp', start: 2, duration: 3, filters: ['hflip'], quality: 90 });
  const at = (flag) => args[args.indexOf(flag) + 1];
  assert.equal(at('-c:v'), 'libwebp_anim');
  assert.equal(at('-q:v'), '90');
  assert.equal(at('-loop'), '0');
  assert.equal(at('-f'), 'webp'); // the temporary name carries no usable extension
  assert.equal(at('-vf'), 'hflip');
  assert.ok(args.indexOf('-ss') < args.indexOf('-i')); // seek before the input
  assert.equal(at('-t'), '3');
  assert.ok(args.includes('-an'));
});

test('lossless WebP hands RGB frames over and ignores the quality setting', () => {
  const args = loopArgs({ input: 'a.mp4', out: 'b.webp.part', format: 'webp', quality: 40, lossless: true });
  const at = (flag) => args[args.indexOf(flag) + 1];
  assert.equal(at('-lossless'), '1');
  assert.equal(at('-pix_fmt'), 'bgra');
  assert.equal(at('-q:v'), '75');
  // GIF has no lossless mode: the flag changes nothing there.
  assert.deepEqual(
    loopArgs({ input: 'a.mp4', out: 'b.gif.part', format: 'gif', lossless: true }),
    loopArgs({ input: 'a.mp4', out: 'b.gif.part', format: 'gif' }),
  );
});

test('GIF goes through a palette built from the clip itself', () => {
  const args = loopArgs({ input: 'a.mp4', out: 'b.gif.part', format: 'gif', filters: ['fps=15.000'] });
  const graph = args[args.indexOf('-filter_complex') + 1];
  assert.match(graph, /^\[0:v:0\]fps=15\.000,split\[a\]\[b\];\[a\]palettegen=stats_mode=diff\[p\];\[b\]\[p\]paletteuse=/);
  assert.equal(args[args.indexOf('-f') + 1], 'gif');
  assert.equal(args.includes('-ss'), false); // no `-ss 0`
  const bare = loopArgs({ input: 'a.mp4', out: 'b.gif.part', format: 'gif' });
  assert.match(bare[bare.indexOf('-filter_complex') + 1], /^\[0:v:0\]split\[a\]\[b\];/);
});

test('refusals are decided before ffmpeg is started', async () => {
  assert.equal(MAX_LOOP_SEC, 60);
  assert.equal((await exportLoop(null, {})).ok, false);
  assert.equal((await exportLoop(null, { path: 'https://example.com/a.mp4', out: 'x.webp' })).ok, false);
  const unknown = await exportLoop(null, { path: 'a.mp4', out: 'x.apng', format: 'apng' });
  assert.equal(unknown.ok, false);
  assert.match(unknown.error, /apng/);
});
