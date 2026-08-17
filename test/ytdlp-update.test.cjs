const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');

// The refresh is run in a child process with its own NR_HOME: `core/config` resolves the writable
// home once, at require time, and the marker this module writes must land in a throwaway file
// rather than in the home of the application installed on the machine running the tests.
function runScenario(script, config = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'netsuboard-ytdlp-test-'));
  const fakeBin = path.join(home, 'yt-dlp.exe');
  fs.writeFileSync(fakeBin, 'not a real binary; execFile is stubbed');
  fs.writeFileSync(path.join(home, 'nr.config.json'), JSON.stringify({ ytDlp: fakeBin, ...config }));
  try {
    const run = spawnSync(process.execPath, ['-e', script], {
      cwd: root,
      env: { ...process.env, NR_HOME: home },
      encoding: 'utf8',
    });
    assert.equal(run.status, 0, run.stderr);
    return {
      result: JSON.parse(run.stdout.trim().split(/\r?\n/).pop() || '{}'),
      saved: JSON.parse(fs.readFileSync(path.join(home, 'nr.config.json'), 'utf8')),
      bin: fakeBin,
    };
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}

// `execFile` is destructured when core/ytdlpUpdate loads, so the stub has to be installed before
// the require — which is also the only way to keep this suite off the network.
const STUB = (body) => `
  const cp = require('node:child_process');
  const calls = [];
  cp.execFile = ${body};
  const { refreshYtDlpForAppVersion } = require('./core/ytdlpUpdate');
  (async () => {
    const first = await refreshYtDlpForAppVersion();
    const second = await refreshYtDlpForAppVersion();
    console.log(JSON.stringify({ first, second, calls }));
  })();
`;

const SUCCESS = STUB(`(bin, args, opts, cb) => { calls.push({ bin, args }); cb(null, 'yt-dlp is up to date (stable@2026.07.04)', ''); }`);
const FAILURE = STUB(`(bin, args, opts, cb) => { calls.push({ bin, args }); cb(new Error('getaddrinfo ENOTFOUND github.com'), '', ''); }`);

const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;

// yt-dlp is the one runtime dependency that rots: its extractors are broken by the platforms every
// few weeks, and nothing replaces the copy `setup.ps1` downloaded on the day of the install.
test('a new application version refreshes yt-dlp exactly once', () => {
  const { result, saved, bin } = runScenario(SUCCESS);
  assert.deepEqual(result.calls, [{ bin, args: ['-U'] }]);
  assert.equal(result.first.updated, true);
  // Second call, same version: the marker short-circuits it, so a plain restart costs nothing.
  assert.equal(result.second.updated, false);
  assert.equal(saved.ytDlpCheckedFor, version);
});

// Being offline the day the application updates must not consume the one refresh that version gets.
test('a failed update leaves the marker unwritten so the next boot retries', () => {
  const { result, saved } = runScenario(FAILURE);
  assert.equal(result.first.updated, false);
  assert.equal(saved.ytDlpCheckedFor, undefined);
  // Both calls really ran: nothing was recorded to skip the second.
  assert.equal(result.calls.length, 2);
});

// Already checked for this version: no spawn at all, including the very first boot of the session.
test('a boot of an already-checked version never launches yt-dlp', () => {
  const { result } = runScenario(SUCCESS, { ytDlpCheckedFor: version });
  assert.deepEqual(result.calls, []);
  assert.equal(result.first.updated, false);
});

// A pip module or a yt-dlp the user put on their own PATH is not this product's to replace, and
// `-U` refuses on a pip install anyway.
test('only the provisioned standalone binary is updated', () => {
  const { result } = runScenario(SUCCESS, { ytDlp: 'yt-dlp.exe' });
  assert.deepEqual(result.calls, []);
  assert.equal(result.first.reason, 'yt-dlp non provisionné');
});
