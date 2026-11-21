const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { FIXTURE_NAMES, loadFixture } = require('../clients/fixture-clients');
const { previewRooms } = require('../preview-rooms');

const entrypoint = path.resolve(__dirname, '../preview-rooms.js');

function runPreview(args = []) {
  return spawnSync(process.execPath, [entrypoint, ...args], {
    cwd: os.tmpdir(), encoding: 'utf8', timeout: 5000,
  });
}

test('room preview runs from another directory and reports each fixture as pending room-only checks', () => {
  for (const name of FIXTURE_NAMES) {
    const result = runPreview([name]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, '');
    const rooms = JSON.parse(result.stdout);
    const fixture = loadFixture(name);
    assert.equal(rooms.mode, 'fixture');
    assert.equal(rooms.validationStatus, 'pending');
    assert.equal(rooms.scope, 'room-checks-only');
    assert.equal(rooms.scenarioId, fixture.scenarioId);
    assert.deepEqual(rooms.eligibleRoomIds, [...fixture.expected.directRoomIds].sort());
    assert.equal(rooms.roomChecks.length, fixture.rooms.length);
    assert.equal(rooms.expected, undefined);
    assert.equal(rooms.candidates, undefined);
    assert.equal(rooms.moves, undefined);
  }
});

test('default room preview agrees with the exported function and default relocation fixture', async () => {
  const result = runPreview();
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.scenarioId, loadFixture('single-relocation').scenarioId);
  assert.deepEqual(output, await previewRooms());
});

test('room preview rejects unknown fixtures and path traversal without successful JSON output', () => {
  for (const name of ['unknown-fixture', '../single-relocation', '../../.env']) {
    const result = runPreview([name]);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /FIXTURE_NOT_FOUND/);
  }
});
