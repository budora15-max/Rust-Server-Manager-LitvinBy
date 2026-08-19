const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePng(size, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const stride = size * 4;
  const raw = Buffer.alloc(size * (1 + stride));
  for (let y = 0; y < size; y++) {
    raw[y * (1 + stride)] = 0; // filter none
    rgba.copy(raw, y * (1 + stride) + 1, y * stride, (y + 1) * stride);
  }
  const idat = zlib.deflateRawSync(raw, { level: 9 });
  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

const SHIELD = [
  [0.22, 0.16],
  [0.78, 0.16],
  [0.78, 0.5],
  [0.5, 0.86],
  [0.22, 0.5],
];

function pointInPoly(px, py, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const RUST = [224, 86, 56, 255];
const RUST_DARK = [172, 58, 32, 255];
const TRANSPARENT = [0, 0, 0, 0];

function drawIcon(size) {
  const buf = Buffer.alloc(size * size * 4);
  const cx = 0.5;
  const cy = 0.53;
  const INNER = SHIELD.map(([x, y]) => [cx + (x - cx) * 0.7, cy + (y - cy) * 0.7]);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = (x + 0.5) / size;
      const ny = (y + 0.5) / size;
      let color = TRANSPARENT;
      if (pointInPoly(nx, ny, SHIELD)) {
        color = pointInPoly(nx, ny, INNER) ? RUST_DARK : RUST;
      }
      const i = (y * size + x) * 4;
      buf[i] = color[0];
      buf[i + 1] = color[1];
      buf[i + 2] = color[2];
      buf[i + 3] = color[3];
    }
  }
  return buf;
}

function encodeIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(entries.length, 4);
  const dirs = [];
  const blobs = [];
  let offset = 6 + entries.length * 16; // все записи каталога идут подряд в начале
  for (const { size, dib } of entries) {
    const dir = Buffer.alloc(16);
    dir[0] = size === 256 ? 0 : size;
    dir[1] = size === 256 ? 0 : size;
    dir[2] = 0;
    dir[3] = 0;
    dir.writeUInt16LE(1, 4); // planes
    dir.writeUInt16LE(32, 6); // bpp
    dir.writeUInt32LE(dib.length, 8);
    dir.writeUInt32LE(offset, 12);
    dirs.push(dir);
    blobs.push(dib);
    offset += dib.length;
  }
  return Buffer.concat([header, ...dirs, ...blobs]);
}

function bmpEntry(size, rgba) {
  const xorStride = size * 4;
  const xor = Buffer.alloc(xorStride * size);
  for (let y = 0; y < size; y++) {
    const srcRow = y * xorStride;
    const dstRow = (size - 1 - y) * xorStride;
    for (let x = 0; x < size; x++) {
      const si = srcRow + x * 4;
      const di = dstRow + x * 4;
      xor[di] = rgba[si + 2]; // B
      xor[di + 1] = rgba[si + 1]; // G
      xor[di + 2] = rgba[si]; // R
      xor[di + 3] = rgba[si + 3]; // A
    }
  }
  const andStride = Math.ceil(size / 32) * 4;
  const andMask = Buffer.alloc(andStride * size); // 0 = прозрачность через альфу
  const header = Buffer.alloc(40);
  header.writeInt32LE(40, 0); // biSize
  header.writeInt32LE(size, 4); // biWidth
  header.writeInt32LE(size * 2, 8); // biHeight (XOR+AND)
  header.writeUInt16LE(1, 12); // biPlanes
  header.writeUInt16LE(32, 14); // biBitCount
  header.writeUInt32LE(0, 16); // biCompression
  return Buffer.concat([header, xor, andMask]);
}

const outDir = path.join(__dirname, '..', 'build');
fs.mkdirSync(outDir, { recursive: true });
const big = encodePng(256, drawIcon(256));
const mid = encodePng(32, drawIcon(32));
const small = encodePng(16, drawIcon(16));
fs.writeFileSync(path.join(outDir, 'icon.png'), big);
fs.writeFileSync(path.join(outDir, 'tray.png'), small);
fs.writeFileSync(
  path.join(outDir, 'icon.ico'),
  encodeIco([
    { size: 256, dib: bmpEntry(256, drawIcon(256)) },
    { size: 48, dib: bmpEntry(48, drawIcon(48)) },
    { size: 32, dib: bmpEntry(32, drawIcon(32)) },
    { size: 16, dib: bmpEntry(16, drawIcon(16)) },
  ])
);
console.log('Icons written to build/ (icon.ico, icon.png, tray.png)');
