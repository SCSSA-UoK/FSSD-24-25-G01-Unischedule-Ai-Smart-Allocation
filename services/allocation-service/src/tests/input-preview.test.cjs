const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const request = require('supertest');
const { createApp } = require('../app');
const { FIXTURE_NAMES, loadFixture } = require('../clients/fixture-clients');

const entrypoint = path.resolve(__dirname, '../preview-input.js');

test('the preview command prepares each fixture without returning hand-written answers', () => {
  for (const name of FIXTURE_NAMES) {
    const result = spawnSync(process.execPath, [entrypoint, name], { encoding: 'utf8', timeout: 5000 });
    assert.equal(result.status, 0, result.stderr);
    const input = JSON.parse(result.stdout);
    assert.equal(input.mode, 'fixture');
    assert.equal(input.validationStatus, 'pending');
    assert.equal(input.request.scenarioId, loadFixture(name).scenarioId);
    assert.ok(input.affectedSession);
    assert.equal(input.expected, undefined);
    assert.equal(input.candidates, undefined);
    assert.equal(input.snapshot.expected, undefined);
  }
});

test('the preview command rejects unknown fixtures without a successful JSON result', () => {
  const result = spawnSync(process.execPath, [entrypoint, '../single-relocation'], {
    encoding: 'utf8', timeout: 5000,
  });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /FIXTURE_NOT_FOUND/);
});

test('a valid relocation request reaches the direct-only endpoint without returning the fixture proposal', async () => {
  const result = await request(createApp()).post('/allocation/candidates')
    .send(loadFixture('single-relocation').request).expect(200);
  assert.equal(result.body.mode, 'fixture');
  assert.equal(result.body.scope, 'direct-only');
  assert.equal(result.body.validationStatus, 'pending');
  assert.equal(result.body.truncated, false);
  assert.deepEqual(result.body.candidates, []);
  assert.equal(result.body.expected, undefined);
});
