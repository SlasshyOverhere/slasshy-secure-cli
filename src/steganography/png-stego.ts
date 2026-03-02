import fs from 'fs/promises';
import { PNG } from 'pngjs';
import { calculateChecksum, verifyChecksum } from '../crypto/index.js';

// Magic bytes to identify steganographic content
const MAGIC_BYTES = Buffer.from([0x53, 0x4C, 0x53, 0x48]); // "SLSH"
const HEADER_SIZE = 16; // Magic(4) + Length(4) + Checksum(8)

export interface EmbedResult {
  outputPath: string;
  bytesEmbedded: number;
  capacity: number;
  checksum: string;
}

export interface ExtractResult {
  data: Buffer;
  checksum: string;
}

/**
 * Calculate the steganographic capacity of a PNG image
 * Using LSB of RGB channels (1 bit per channel = 3 bits per pixel)
 */
export function calculateCapacity(width: number, height: number): number {
  // Each pixel has RGB (3 channels), each can store 1 bit
  // So 3 bits per pixel = 3/8 bytes per pixel
  const totalBits = width * height * 3;
  const totalBytes = Math.floor(totalBits / 8);
  // Reserve space for header
  return totalBytes - HEADER_SIZE;
}

/**
 * Load a PNG image from file
 */
export async function loadPNG(imagePath: string): Promise<PNG> {
  const buffer = await fs.readFile(imagePath);
  return new Promise((resolve, reject) => {
    new PNG().parse(buffer, (error: Error | null, png: PNG) => {
      if (error) reject(error);
      else resolve(png);
    });
  });
}

/**
 * Save a PNG image to file
 */
export async function savePNG(png: PNG, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    png.pack()
      .on('data', (chunk: Buffer) => chunks.push(chunk))
      .on('end', async () => {
        await fs.writeFile(outputPath, Buffer.concat(chunks));
        resolve();
      })
      .on('error', reject);
  });
}

/**
 * Create header for embedded data
 */
function createHeader(dataLength: number, checksum: string): Buffer {
  const header = Buffer.alloc(HEADER_SIZE);

  // Magic bytes (4)
  MAGIC_BYTES.copy(header, 0);

  // Data length as uint32 big-endian (4)
  header.writeUInt32BE(dataLength, 4);

  // Checksum (8 bytes from hex string)
  Buffer.from(checksum, 'hex').copy(header, 8);

  return header;
}

/**
 * Parse header from extracted data
 */
function parseHeader(header: Buffer): { length: number; checksum: string } | null {
  // Verify magic bytes
  if (!header.subarray(0, 4).equals(MAGIC_BYTES)) {
    return null;
  }

  const length = header.readUInt32BE(4);
  const checksum = header.subarray(8, 16).toString('hex');

  return { length, checksum };
}

/**
 * Embed encrypted data into a PNG image using LSB steganography
 */
export async function embedInPNG(
  carrierPath: string,
  data: Buffer,
  outputPath: string
): Promise<EmbedResult> {
  const png = await loadPNG(carrierPath);
  const capacity = calculateCapacity(png.width, png.height);

  if (data.length > capacity) {
    throw new Error(
      `Data too large for carrier. Data: ${data.length} bytes, Capacity: ${capacity} bytes`
    );
  }

  const checksum = calculateChecksum(data);
  const header = createHeader(data.length, checksum);
  const payload = Buffer.concat([header, data]);

  let byteIndex = 0;
  let bitOffset = 7;
  const totalBytes = payload.length;

  // ⚡ Bolt Optimization:
  // - Removing bufferToBits which creates an enormous number[]
  // - Direct bitwise buffer manipulation saves massive memory and CPU time
  for (let i = 0; i < png.data.length && byteIndex < totalBytes; i++) {
    if ((i & 3) === 3) continue; // Skip alpha channel faster

    const bit = (payload[byteIndex]! >> bitOffset) & 1;
    png.data[i] = (png.data[i]! & 0xFE) | bit;

    bitOffset--;
    if (bitOffset < 0) {
      bitOffset = 7;
      byteIndex++;
    }
  }

  await savePNG(png, outputPath);

  return {
    outputPath,
    bytesEmbedded: data.length,
    capacity,
    checksum,
  };
}

/**
 * Extract hidden data from a PNG image
 */
export async function extractFromPNG(imagePath: string): Promise<ExtractResult> {
  const png = await loadPNG(imagePath);

  // ⚡ Bolt Optimization:
  // - Removing bitsToBuffer and bits array allocation (saves multi-megabyte allocations)
  // - Direct bit extraction directly decodes into header and payload buffers
  const headerBuffer = Buffer.alloc(HEADER_SIZE);
  let byteIndex = 0;
  let bitOffset = 7;

  let headerInfo: { length: number; checksum: string } | null = null;
  let payloadBuffer: Buffer | null = null;

  for (let i = 0; i < png.data.length; i++) {
    if ((i & 3) === 3) continue; // Skip alpha channel

    const bit = png.data[i]! & 1;

    if (!headerInfo) {
      headerBuffer[byteIndex] = headerBuffer[byteIndex]! | (bit << bitOffset);
      bitOffset--;

      if (bitOffset < 0) {
        bitOffset = 7;
        byteIndex++;

        if (byteIndex === HEADER_SIZE) {
          headerInfo = parseHeader(headerBuffer);
          if (!headerInfo) throw new Error('No hidden data found in image');
          if (headerInfo.length === 0) {
            const emptyPayload = Buffer.alloc(0);
            if (!verifyChecksum(emptyPayload, headerInfo.checksum)) {
              throw new Error('Data integrity check failed: checksum mismatch');
            }
            return { data: emptyPayload, checksum: headerInfo.checksum };
          }
          payloadBuffer = Buffer.alloc(headerInfo.length);
          byteIndex = 0; // Reset for payload
        }
      }
    } else {
      payloadBuffer![byteIndex] = payloadBuffer![byteIndex]! | (bit << bitOffset);
      bitOffset--;

      if (bitOffset < 0) {
        bitOffset = 7;
        byteIndex++;

        if (byteIndex === headerInfo.length) {
          if (!verifyChecksum(payloadBuffer!, headerInfo.checksum)) {
            throw new Error('Data integrity check failed: checksum mismatch');
          }
          return { data: payloadBuffer!, checksum: headerInfo.checksum };
        }
      }
    }
  }

  throw new Error('Incomplete data');
}

/**
 * Check if an image has embedded data
 */
export async function hasEmbeddedData(imagePath: string): Promise<boolean> {
  try {
    const png = await loadPNG(imagePath);

    // Extract just enough bits for magic bytes (4 bytes = 32 bits)
    const magicBuffer = Buffer.alloc(4);
    let byteIndex = 0;
    let bitOffset = 7;

    for (let i = 0; i < png.data.length; i++) {
      if ((i & 3) === 3) continue; // Skip alpha channel

      const bit = png.data[i]! & 1;
      magicBuffer[byteIndex] = magicBuffer[byteIndex]! | (bit << bitOffset);

      bitOffset--;
      if (bitOffset < 0) {
        bitOffset = 7;
        byteIndex++;
        if (byteIndex === 4) break;
      }
    }

    return magicBuffer.equals(MAGIC_BYTES);
  } catch {
    return false;
  }
}

/**
 * Get image info for capacity calculation
 */
export async function getImageInfo(imagePath: string): Promise<{
  width: number;
  height: number;
  capacity: number;
}> {
  const png = await loadPNG(imagePath);
  return {
    width: png.width,
    height: png.height,
    capacity: calculateCapacity(png.width, png.height),
  };
}
