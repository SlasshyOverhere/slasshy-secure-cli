import fs from 'fs/promises';
import path from 'path';
import { PNG } from 'pngjs';
import { randomInt, randomBytes } from '../crypto/index.js';

export interface GeneratedCarrier {
  path: string;
  width: number;
  height: number;
  capacity: number;
}

/**
 * Generate a procedural PNG image that looks natural
 */
export async function generateCarrierImage(
  outputPath: string,
  minCapacity: number = 10000 // Minimum bytes needed
): Promise<GeneratedCarrier> {
  // Calculate dimensions to fit required capacity
  // Capacity = (width * height * 3) / 8 - 16 (header)
  const minPixels = Math.ceil((minCapacity + 16) * 8 / 3);
  const minDimension = Math.ceil(Math.sqrt(minPixels));

  // Add some randomness to dimensions (make it look natural)
  const width = Math.max(800, minDimension + randomInt(100, 400));
  const height = Math.max(600, minDimension + randomInt(50, 300));

  const png = new PNG({ width, height });

  // Choose a random pattern type
  const patternType = randomInt(0, 5);

  // Generate base colors
  const baseR = randomInt(50, 200);
  const baseG = randomInt(50, 200);
  const baseB = randomInt(50, 200);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (width * y + x) * 4;

      let r: number, g: number, b: number;

      switch (patternType) {
        case 0:
          // Gradient with noise (sky-like)
          r = Math.min(255, baseR + Math.floor((y / height) * 80) + randomInt(-5, 5));
          g = Math.min(255, baseG + Math.floor((y / height) * 60) + randomInt(-5, 5));
          b = Math.min(255, baseB + Math.floor((y / height) * 100) + randomInt(-5, 5));
          break;

        case 1:
          // Perlin-like noise (natural texture)
          const noise1 = Math.sin(x * 0.02) * Math.cos(y * 0.02) * 50;
          const noise2 = Math.sin(x * 0.05 + y * 0.03) * 30;
          r = Math.min(255, Math.max(0, baseR + noise1 + randomInt(-10, 10)));
          g = Math.min(255, Math.max(0, baseG + noise2 + randomInt(-10, 10)));
          b = Math.min(255, Math.max(0, baseB + noise1 + noise2 + randomInt(-10, 10)));
          break;

        case 2:
          // Abstract art pattern
          const wave = Math.sin((x + y) * 0.01) * 127 + 128;
          r = Math.floor(wave * (baseR / 255)) + randomInt(-3, 3);
          g = Math.floor((255 - wave) * (baseG / 255)) + randomInt(-3, 3);
          b = Math.floor(Math.abs(Math.sin(x * 0.02) * 255) * (baseB / 255)) + randomInt(-3, 3);
          break;

        case 3:
          // Cloudy/marble texture
          const marble = Math.sin(x * 0.01 + Math.sin(y * 0.02) * 3) * 50 +
                        Math.cos(y * 0.01 + Math.cos(x * 0.02) * 3) * 50;
          r = Math.min(255, Math.max(0, 150 + marble + randomInt(-8, 8)));
          g = Math.min(255, Math.max(0, 150 + marble + randomInt(-8, 8)));
          b = Math.min(255, Math.max(0, 160 + marble + randomInt(-8, 8)));
          break;

        case 4:
          // Sunset gradient
          const sunsetY = y / height;
          r = Math.min(255, Math.floor(255 - sunsetY * 100) + randomInt(-5, 5));
          g = Math.min(255, Math.floor(150 - sunsetY * 80 + Math.sin(x * 0.01) * 20) + randomInt(-5, 5));
          b = Math.min(255, Math.floor(100 + sunsetY * 100) + randomInt(-5, 5));
          break;

        default:
          // Nature-like green/brown
          const nature = Math.sin(x * 0.03) * Math.sin(y * 0.03) * 30;
          r = Math.min(255, Math.max(0, 80 + nature + randomInt(-15, 15)));
          g = Math.min(255, Math.max(0, 120 + nature + randomInt(-15, 15)));
          b = Math.min(255, Math.max(0, 60 + nature + randomInt(-10, 10)));
      }

      png.data[idx] = Math.min(255, Math.max(0, r));
      png.data[idx + 1] = Math.min(255, Math.max(0, g));
      png.data[idx + 2] = Math.min(255, Math.max(0, b));
      png.data[idx + 3] = 255; // Alpha
    }
  }

  // Save the image
  await new Promise<void>((resolve, reject) => {
    const chunks: Buffer[] = [];
    png.pack()
      .on('data', (chunk: Buffer) => chunks.push(chunk))
      .on('end', async () => {
        await fs.writeFile(outputPath, Buffer.concat(chunks));
        resolve();
      })
      .on('error', reject);
  });

  const capacity = Math.floor((width * height * 3) / 8) - 16;

  return {
    path: outputPath,
    width,
    height,
    capacity,
  };
}

/**
 * Generate multiple carrier images for syncing
 */
export async function generateCarriers(
  outputDir: string,
  count: number,
  minCapacityPerImage: number = 50000
): Promise<GeneratedCarrier[]> {
  await fs.mkdir(outputDir, { recursive: true });

  const carriers: GeneratedCarrier[] = [];

  for (let i = 0; i < count; i++) {
    const filename = generateCarrierFilename();
    const outputPath = path.join(outputDir, filename);

    const carrier = await generateCarrierImage(outputPath, minCapacityPerImage);
    carriers.push(carrier);
  }

  return carriers;
}

/**
 * Generate a realistic-looking filename
 */
function generateCarrierFilename(): string {
  const now = new Date();
  const daysAgo = randomInt(1, 365);
  const date = new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000);

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(randomInt(6, 22)).padStart(2, '0');
  const minutes = String(randomInt(0, 59)).padStart(2, '0');
  const seconds = String(randomInt(0, 59)).padStart(2, '0');

  const prefixes = ['IMG', 'DSC', 'PXL', 'PHOTO'];
  const prefix = prefixes[randomInt(0, prefixes.length - 1)];
  const suffix = randomBytes(2).toString('hex').toUpperCase();

  return `${prefix}_${year}${month}${day}_${hours}${minutes}${seconds}_${suffix}.png`;
}

/**
 * Ensure we have enough carrier capacity for data
 */
export async function ensureCarrierCapacity(
  outputDir: string,
  requiredBytes: number,
  existingCarriers: GeneratedCarrier[] = []
): Promise<GeneratedCarrier[]> {
  let totalCapacity = existingCarriers.reduce((sum, c) => sum + c.capacity, 0);
  const carriers = [...existingCarriers];

  while (totalCapacity < requiredBytes) {
    const needed = requiredBytes - totalCapacity;
    const carrier = await generateCarrierImage(
      path.join(outputDir, generateCarrierFilename()),
      Math.min(needed, 100000) // Cap at 100KB per image for variety
    );
    carriers.push(carrier);
    totalCapacity += carrier.capacity;
  }

  return carriers;
}
