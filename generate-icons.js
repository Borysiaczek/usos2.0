// Script to generate valid PNG icons for USOSweb 2.0 extension
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function createPng(width, height, drawFn) {
  // RGBA buffer
  const rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const color = drawFn(x, y, width, height);
      rgba[idx] = color.r;
      rgba[idx + 1] = color.g;
      rgba[idx + 2] = color.b;
      rgba[idx + 3] = color.a;
    }
  }

  // Scanlines with filter byte 0
  const scanlines = Buffer.alloc(height * (1 + width * 4));
  let scanIdx = 0;
  for (let y = 0; y < height; y++) {
    scanlines[scanIdx++] = 0; // Filter: None
    const rowStart = y * width * 4;
    rgba.copy(scanlines, scanIdx, rowStart, rowStart + width * 4);
    scanIdx += width * 4;
  }

  const compressed = zlib.deflateSync(scanlines);

  // PNG Header
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // 8 bits per channel
  ihdrData[9] = 6; // RGBA
  ihdrData[10] = 0; // Deflate
  ihdrData[11] = 0; // Filter
  ihdrData[12] = 0; // Interlace
  const ihdrChunk = createChunk('IHDR', ihdrData);

  // IDAT
  const idatChunk = createChunk('IDAT', compressed);

  // IEND
  const iendChunk = createChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

function createChunk(type, data) {
  const length = data.length;
  const chunk = Buffer.alloc(8 + length + 4);
  chunk.writeUInt32BE(length, 0);
  chunk.write(type, 4, 4, 'ascii');
  data.copy(chunk, 8);

  // CRC-32
  const crcTarget = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = crc32(crcTarget);
  chunk.writeUInt32BE(crc >>> 0, 8 + length);
  return chunk;
}

// Simple CRC32 table
let crcTable = null;
function getCrcTable() {
  if (crcTable) return crcTable;
  crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      if (c & 1) c = 0xedb88320 ^ (c >>> 1);
      else c = c >>> 1;
    }
    crcTable[n] = c;
  }
  return crcTable;
}

function crc32(buf) {
  const table = getCrcTable();
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// Design: sleek rounded square, indigo-to-teal gradient with modern "U" monogram and "2.0" accent
function drawIcon(x, y, w, h) {
  const radius = w * 0.22;
  const cx = w / 2;
  const cy = h / 2;

  // Check rounded rectangle bounds
  const dx = Math.max(Math.abs(x - cx) - (cx - radius), 0);
  const dy = Math.max(Math.abs(y - cy) - (cy - radius), 0);
  const dist = Math.sqrt(dx * dx + dy * dy);

  if (dist > radius) {
    return { r: 0, g: 0, b: 0, a: 0 }; // Transparent outside
  }

  // Smooth anti-aliased edge
  let alpha = 255;
  if (dist > radius - 1) {
    alpha = Math.round(255 * (radius - dist));
  }

  // Gradient: Indigo (#4F46E5 -> rgb 79, 70, 229) to Sky/Cyan (#06B6D4 -> rgb 6, 182, 212)
  const t = (x + y) / (w + h);
  let r = Math.round(79 * (1 - t) + 14 * t);
  let g = Math.round(70 * (1 - t) + 165 * t);
  let b = Math.round(229 * (1 - t) + 233 * t);

  // Render "U" glyph in white
  const nx = x / w;
  const ny = y / h;

  // Outer U boundary: nx between 0.26 and 0.74, ny between 0.24 and 0.76
  // Inner U cutout: nx between 0.42 and 0.58, ny between 0.24 and 0.60
  const isUOuter = (nx >= 0.26 && nx <= 0.74 && ny >= 0.24 && ny <= 0.76);
  const isUInner = (nx >= 0.42 && nx <= 0.58 && ny >= 0.24 && ny <= 0.60);
  const isRoundBottom = ny > 0.60 && ny <= 0.76 && nx >= 0.26 && nx <= 0.74;

  let isGlyph = false;
  if (isUOuter && !isUInner) {
    if (isRoundBottom) {
      // Bottom curve
      const bcx = 0.50;
      const bcy = 0.60;
      const rx = (nx - bcx) / 0.24;
      const ry = (ny - bcy) / 0.16;
      const rInnerX = (nx - bcx) / 0.08;
      const rInnerY = (ny - bcy) / 0.08;
      if (rx * rx + ry * ry <= 1.0 && (rInnerX * rInnerX + rInnerY * rInnerY >= 0.8 || ny <= 0.60)) {
        isGlyph = true;
      }
    } else {
      isGlyph = true;
    }
  }

  // Dot for "2.0" accent at bottom right (nx ~ 0.78, ny ~ 0.76)
  const dotDx = (nx - 0.76) * w;
  const dotDy = (ny - 0.76) * h;
  const dotR = w * 0.07;
  if (dotDx * dotDx + dotDy * dotDy <= dotR * dotR) {
    return { r: 52, g: 211, b: 153, a: alpha }; // Emerald green dot
  }

  if (isGlyph) {
    return { r: 255, g: 255, b: 255, a: alpha };
  }

  return { r, g, b, a: alpha };
}

const iconsDir = path.join(__dirname, 'icons');
if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

[16, 48, 128].forEach(size => {
  const pngData = createPng(size, size, drawIcon);
  fs.writeFileSync(path.join(iconsDir, `icon${size}.png`), pngData);
  console.log(`Generated icon${size}.png (${pngData.length} bytes)`);
});
