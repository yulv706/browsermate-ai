import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";

const sizes = [16, 32, 48, 128];
const outputDir = "icons";
const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

mkdirSync(outputDir, { recursive: true });

for (const size of sizes) {
  writeFileSync(join(outputDir, `icon${size}.png`), createIcon(size));
}

console.log(`Generated ${sizes.length} icons in ${outputDir}/`);

function createIcon(size) {
  const pixels = new Uint8Array(size * size * 4);
  const radius = size * 0.18;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const index = (y * size + x) * 4;
      const alpha = roundedRectAlpha(x + 0.5, y + 0.5, size, size, radius);
      if (alpha <= 0) continue;

      const t = (x + y) / (size * 2);
      const base = mixColor([22, 60, 66], [31, 102, 95], t);
      pixels[index] = base[0];
      pixels[index + 1] = base[1];
      pixels[index + 2] = base[2];
      pixels[index + 3] = Math.round(alpha * 255);
    }
  }

  drawRect(pixels, size, 0.28, 0.22, 0.42, 0.78, [248, 223, 158, 255]);
  drawRect(pixels, size, 0.38, 0.22, 0.70, 0.34, [248, 223, 158, 255]);
  drawRect(pixels, size, 0.62, 0.30, 0.75, 0.52, [248, 223, 158, 255]);
  drawRect(pixels, size, 0.38, 0.47, 0.68, 0.60, [248, 223, 158, 255]);

  return encodePng(size, size, pixels);
}

function roundedRectAlpha(x, y, width, height, radius) {
  const left = radius;
  const right = width - radius;
  const top = radius;
  const bottom = height - radius;
  const cx = Math.max(left, Math.min(x, right));
  const cy = Math.max(top, Math.min(y, bottom));
  const distance = Math.hypot(x - cx, y - cy);
  if (distance <= radius - 1) return 1;
  if (distance >= radius) return 0;
  return radius - distance;
}

function mixColor(start, end, t) {
  return start.map((value, index) => Math.round(value + (end[index] - value) * t));
}

function drawRect(pixels, size, x1, y1, x2, y2, color) {
  const minX = Math.floor(x1 * size);
  const maxX = Math.ceil(x2 * size);
  const minY = Math.floor(y1 * size);
  const maxY = Math.ceil(y2 * size);

  for (let y = minY; y < maxY; y += 1) {
    for (let x = minX; x < maxX; x += 1) {
      const index = (y * size + x) * 4;
      const bgAlpha = pixels[index + 3] / 255;
      if (bgAlpha === 0) continue;
      pixels[index] = color[0];
      pixels[index + 1] = color[1];
      pixels[index + 2] = color[2];
      pixels[index + 3] = Math.max(pixels[index + 3], color[3]);
    }
  }
}

function encodePng(width, height, rgba) {
  const rowLength = width * 4 + 1;
  const raw = new Uint8Array(rowLength * height);

  for (let y = 0; y < height; y += 1) {
    raw[y * rowLength] = 0;
    raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * rowLength + 1);
  }

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", Buffer.concat([uint32(width), uint32(height), Buffer.from([8, 6, 0, 0, 0])])),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type);
  return Buffer.concat([uint32(data.length), typeBuffer, data, uint32(crc32(Buffer.concat([typeBuffer, data])))]);
}

function uint32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value >>> 0);
  return buffer;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
