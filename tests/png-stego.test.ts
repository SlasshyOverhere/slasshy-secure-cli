import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { PNG } from 'pngjs';
import { embedInPNG, extractFromPNG, hasEmbeddedData } from '../src/steganography/png-stego.js';

function createCarrierPngBuffer(width: number, height: number): Buffer {
  const png = new PNG({ width, height });
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = 120;
    png.data[i + 1] = 180;
    png.data[i + 2] = 220;
    png.data[i + 3] = 255;
  }
  return PNG.sync.write(png);
}

describe('PNG steganography', () => {
  it('round-trips non-empty payloads', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'blankdrive-stego-test-'));
    const carrierPath = path.join(tempDir, 'carrier.png');
    const outputPath = path.join(tempDir, 'encoded.png');
    const payload = Buffer.from('hello-blankdrive', 'utf-8');

    try {
      await fs.writeFile(carrierPath, createCarrierPngBuffer(32, 32));
      await embedInPNG(carrierPath, payload, outputPath);
      const extracted = await extractFromPNG(outputPath);
      expect(extracted.data.equals(payload)).toBe(true);
      expect(await hasEmbeddedData(outputPath)).toBe(true);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('round-trips empty payloads', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'blankdrive-stego-test-'));
    const carrierPath = path.join(tempDir, 'carrier.png');
    const outputPath = path.join(tempDir, 'encoded-empty.png');
    const payload = Buffer.alloc(0);

    try {
      await fs.writeFile(carrierPath, createCarrierPngBuffer(32, 32));
      await embedInPNG(carrierPath, payload, outputPath);
      const extracted = await extractFromPNG(outputPath);
      expect(extracted.data.length).toBe(0);
      expect(await hasEmbeddedData(outputPath)).toBe(true);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('returns false for clean carriers with no payload', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'blankdrive-stego-test-'));
    const carrierPath = path.join(tempDir, 'clean.png');

    try {
      await fs.writeFile(carrierPath, createCarrierPngBuffer(32, 32));
      expect(await hasEmbeddedData(carrierPath)).toBe(false);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
});
