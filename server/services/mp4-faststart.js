import { open } from 'node:fs/promises';

// MP4 top-level boxes have a 32-bit size, or a 64-bit extended size when the
// 32-bit size is 1. Never load the media data into memory to inspect them.
const MAX_TOP_LEVEL_BOXES = 100_000;

export async function hasFaststartAtoms(fileSize, readAt) {
  if (!Number.isSafeInteger(fileSize) || fileSize < 16 || typeof readAt !== 'function') return false;
  let position = 0;
  let sawMoov = false;
  try {
    for (let count = 0; count < MAX_TOP_LEVEL_BOXES && position + 8 <= fileSize; count++) {
      const header = await readAt(position, 8);
      if (!Buffer.isBuffer(header) || header.length !== 8) return false;
      const type = header.toString('latin1', 4, 8);
      const shortSize = header.readUInt32BE(0);
      let boxSize;
      if (shortSize === 1) {
        if (position + 16 > fileSize) return false;
        const extended = await readAt(position + 8, 8);
        if (!Buffer.isBuffer(extended) || extended.length !== 8) return false;
        const longSize = extended.readBigUInt64BE(0);
        if (longSize < 16n || longSize > BigInt(fileSize - position)) return false;
        boxSize = Number(longSize);
      } else if (shortSize === 0) {
        // A zero-sized box extends to EOF; it can contain the final mdat, but
        // cannot precede another top-level box.
        boxSize = fileSize - position;
      } else {
        if (shortSize < 8 || shortSize > fileSize - position) return false;
        boxSize = shortSize;
      }

      if (type === 'mdat') return sawMoov;
      if (type === 'moov') sawMoov = true;
      if (shortSize === 0) return false;
      position += boxSize;
    }
    return false;
  } catch {
    // If the structure cannot be verified, keep the normal optimization.
    return false;
  }
}

export async function hasFaststartMp4(filePath) {
  let handle;
  try {
    handle = await open(filePath, 'r');
    const stat = await handle.stat();
    if (!stat.isFile()) return false;
    return await hasFaststartAtoms(stat.size, async (position, length) => {
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, position);
      return bytesRead === length ? buffer : null;
    });
  } catch {
    return false;
  } finally {
    await handle?.close().catch(() => {});
  }
}
