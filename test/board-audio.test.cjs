// Audio cards: the container a copied track is written in follows its codec, never a re-encode.
const test = require("node:test");
const assert = require("node:assert/strict");
const { extFor } = require("../core/boardAudio");

test("a copied audio track keeps a container that holds its codec", () => {
  assert.equal(extFor("aac"), "m4a");
  assert.equal(extFor("mp3"), "mp3");
  assert.equal(extFor("opus"), "opus");
  assert.equal(extFor("vorbis"), "ogg");
  assert.equal(extFor("flac"), "flac");
  assert.equal(extFor("pcm_s16le"), "wav");
  assert.equal(extFor("pcm_f32le"), "wav");
});

test("an unknown codec goes into Matroska audio rather than being converted", () => {
  assert.equal(extFor("truehd"), "mka");
  assert.equal(extFor(""), "mka");
});
