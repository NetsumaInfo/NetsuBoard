// An Animatic export is one ffmpeg command fed with frames on stdin: what it asks of ffmpeg is
// checked here without running it.
const test = require('node:test');
const assert = require('node:assert/strict');
const { animaticArgs, atempoChain, duckVolume } = require('../core/animaticExport.js');

const ENC = ['-c:v', 'libx264', '-pix_fmt', 'yuv420p'];

test('frames only: JPEG on stdin, no audio, exact length', () => {
  const args = animaticArgs({ out: 'o.mp4', fps: 30, width: 1920, height: 1080, duration: 12.5, encoder: ENC });
  assert.deepEqual(args.slice(args.indexOf('-f'), args.indexOf('-f') + 8), ['-f', 'image2pipe', '-framerate', '30', '-c:v', 'mjpeg', '-i', 'pipe:0']);
  assert.ok(args.includes('-an'));
  assert.ok(!args.includes('-filter_complex'));
  assert.equal(args[args.indexOf('-t') + 1], '12.500');
  assert.equal(args.at(-1), 'o.mp4');
});

test('music alone is mapped straight, lowered inside the duck spans', () => {
  const args = animaticArgs({
    out: 'o.mp4', fps: 24, width: 1280, height: 720, duration: 10, encoder: ENC,
    music: { path: 'm.mp3', duck: [[1, 2], [4, 5.5]] },
  });
  const graph = args[args.indexOf('-filter_complex') + 1];
  assert.equal(graph, "[1:a:0]volume='if(between(t,1.000,2.000)+between(t,4.000,5.500),0.25,1)':eval=frame[m]");
  assert.equal(args[args.lastIndexOf('-map') + 1], '[m]');
  assert.ok(args.includes('aac'));
});

test('sounds are trimmed, sped and placed, then mixed with the music', () => {
  const args = animaticArgs({
    out: 'o.mp4', fps: 30, width: 1920, height: 1080, duration: 10, encoder: ENC,
    music: { path: 'm.mp3' },
    sounds: [{ path: 'v.mp4', from: 2, to: 4, at: 3, speed: 2 }],
  });
  const graph = args[args.indexOf('-filter_complex') + 1].split(';');
  assert.equal(graph[0], '[1:a:0]anull[m]');
  assert.equal(graph[1], '[2:a:0]atrim=start=2.000:end=4.000,asetpts=PTS-STARTPTS,atempo=2.0000,adelay=3000:all=1[s0]');
  assert.equal(graph[2], '[m][s0]amix=inputs=2:normalize=0:duration=longest[a]');
  assert.equal(args[args.lastIndexOf('-map') + 1], '[a]');
});

test('atempo stays inside what one stage accepts', () => {
  assert.deepEqual(atempoChain(1), []);
  assert.deepEqual(atempoChain(0.25), ['atempo=0.5', 'atempo=0.5000']);
  assert.deepEqual(atempoChain(4), ['atempo=2', 'atempo=2.0000']);
  assert.deepEqual(atempoChain(1.5), ['atempo=1.5000']);
});

test('no duck span keeps the music as it is', () => {
  assert.equal(duckVolume([]), 'anull');
  assert.equal(duckVolume([[3, 3]]), 'anull');
});

test('only an encoder failure sends the export back to the CPU', () => {
  const { hardwareFailure } = require('../core/animaticExport.js');
  assert.ok(hardwareFailure('[h264_nvenc @ 0x1] OpenEncodeSessionEx failed: out of memory (10)'));
  assert.ok(hardwareFailure('Error initializing output stream 0:0 -- Error while opening encoder'));
  assert.ok(hardwareFailure('[h264_amf @ 0x2] encoder creation failed'));
  assert.ok(!hardwareFailure('music.mp3: Invalid data found when processing input'));
  assert.ok(!hardwareFailure('No space left on device'));
});

test('a cancel naming another export leaves the open one alone', async () => {
  const { cancelAnimaticExport } = require('../core/animaticExport.js');
  assert.deepEqual(await cancelAnimaticExport(12345), { ok: true, cancelled: false });
});
