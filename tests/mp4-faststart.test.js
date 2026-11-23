import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hasFaststartAtoms, hasFaststartMp4 } from '@/server/services/mp4-faststart.js';

function box(type, payload = Buffer.alloc(0)) {
  const out = Buffer.alloc(8 + payload.length);
  out.writeUInt32BE(out.length, 0);
  out.write(type, 4, 4, 'latin1');
  payload.copy(out, 8);
  return out;
}

test('recognizes metadata before media in real files and rejects reverse order', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'downlink-mp4-faststart-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const fast = join(dir, 'fast.mp4');
  const late = join(dir, 'late.mp4');
  await writeFile(fast, Buffer.concat([box('ftyp'), box('moov'), box('mdat', Buffer.alloc(4))]));
  await writeFile(late, Buffer.concat([box('ftyp'), box('mdat', Buffer.alloc(4)), box('moov')]));
  assert.equal(await hasFaststartMp4(fast), true);
  assert.equal(await hasFaststartMp4(late), false);
  assert.equal(await hasFaststartMp4(join(dir, 'missing.mp4')), false);
});

test('handles extended-size atoms above 4 GiB without allocating media data', async () => {
  const skipSize = 5n * 1024n ** 3n;
  const head = Buffer.alloc(16);
  head.writeUInt32BE(1, 0);
  head.write('free', 4, 4, 'latin1');
  head.writeBigUInt64BE(skipSize, 8);
  const atoms = new Map([[0, head.subarray(0, 8)], [8, head.subarray(8)],
    [Number(skipSize), box('moov')], [Number(skipSize) + 8, box('mdat')]]);
  const read = async (offset, length) => atoms.get(offset)?.subarray(0, length) || null;
  assert.equal(await hasFaststartAtoms(Number(skipSize) + 16, read), true);
  assert.equal(await hasFaststartAtoms(Number(skipSize) - 1, read), false);
});

test('rejects truncated, malformed, missing and overflowing atoms', async () => {
  const bytes = async buffer => hasFaststartAtoms(buffer.length, async (pos, length) => buffer.subarray(pos, pos + length));
  assert.equal(await bytes(Buffer.concat([box('ftyp'), box('moov')])), false);
  const tooShort = Buffer.concat([box('ftyp'), box('moov'), box('mdat')]);
  tooShort.writeUInt32BE(7, 8);
  assert.equal(await bytes(tooShort), false);
  const truncated = Buffer.concat([box('moov'), box('mdat')]);
  truncated.writeUInt32BE(100, 8);
  assert.equal(await bytes(truncated), false);
  const oversized = Buffer.concat([box('moov'), Buffer.from([0, 0, 0, 1, 109, 100, 97, 116]), Buffer.alloc(8, 255)]);
  assert.equal(await bytes(oversized), false);
  const zeroMdat = Buffer.concat([box('moov'), Buffer.from([0, 0, 0, 0, 109, 100, 97, 116])]);
  assert.equal(await bytes(zeroMdat), true);
  const zeroMoov = Buffer.concat([Buffer.from([0, 0, 0, 0, 109, 111, 111, 118]), box('mdat')]);
  assert.equal(await bytes(zeroMoov), false);
  assert.equal(await hasFaststartAtoms(16, async () => { throw new Error('read failure'); }), false);
});
