// AssemblyScript full-pipeline VNC framebuffer decoder.
//
// Architecture:
//   - WASM owns the RGBA framebuffer surface in linear memory.
//   - JS calls initFramebuffer() once on display-init / resize.
//   - For each rectangle in a framebuffer-update, JS calls the appropriate
//     process function which writes directly to the internal surface.
//   - JS reads the framebuffer via getFramebufferPtr() + getFramebufferLen()
//     for canvas rendering — zero-copy from WASM linear memory.
//   - CopyRect operates entirely within WASM memory.
//
// Encoding support: Raw (0), CopyRect (1), RRE (2), CoRRE (4), Hextile (5), ZRLE (16).
// Zlib decompression for ZRLE is done on the JS side; WASM receives the
// already-decompressed tile payload.

// ─── Framebuffer state ──────────────────────────────────────────

let fbWidth: i32 = 0;
let fbHeight: i32 = 0;
let fb: Uint8Array = new Uint8Array(0);

export function initFramebuffer(width: i32, height: i32): void {
  fbWidth = width;
  fbHeight = height;
  fb = new Uint8Array(width * height * 4);
}

export function getFramebufferPtr(): usize {
  return changetype<usize>(fb.dataStart);
}

export function getFramebufferLen(): i32 {
  return fb.length;
}

export function getFramebufferWidth(): i32 {
  return fbWidth;
}

export function getFramebufferHeight(): i32 {
  return fbHeight;
}

// ─── Pixel helpers ──────────────────────────────────────────────

@inline
function scaleChannel(value: i32, max: i32): u8 {
  if (max <= 0) return 0;
  if (max == 255) return <u8>value;
  let scaled = (value * 255 + (max >> 1)) / max;
  if (scaled < 0) scaled = 0;
  if (scaled > 255) scaled = 255;
  return <u8>scaled;
}

@inline
function readPixelValue(src: Uint8Array, offset: i32, bpp: i32, big: bool): u32 {
  if (bpp == 1) return <u32>unchecked(src[offset]);
  if (bpp == 2) {
    return big
      ? (((<u32>unchecked(src[offset])) << 8) | <u32>unchecked(src[offset + 1]))
      : (<u32>unchecked(src[offset]) | ((<u32>unchecked(src[offset + 1])) << 8));
  }
  if (bpp == 3) {
    return big
      ? (((<u32>unchecked(src[offset])) << 16) | ((<u32>unchecked(src[offset + 1])) << 8) | <u32>unchecked(src[offset + 2]))
      : (<u32>unchecked(src[offset]) | ((<u32>unchecked(src[offset + 1])) << 8) | ((<u32>unchecked(src[offset + 2])) << 16));
  }
  return big
    ? ((((<u32>unchecked(src[offset])) << 24) >>> 0) | ((<u32>unchecked(src[offset + 1])) << 16) | ((<u32>unchecked(src[offset + 2])) << 8) | <u32>unchecked(src[offset + 3])) >>> 0
    : (<u32>unchecked(src[offset]) | ((<u32>unchecked(src[offset + 1])) << 8) | ((<u32>unchecked(src[offset + 2])) << 16) | (((<u32>unchecked(src[offset + 3])) << 24) >>> 0)) >>> 0;
}

// Decode one pixel and pack as 0xAABBGGRR (little-endian RGBA in memory)
@inline
function decodePixel(
  src: Uint8Array, offset: i32,
  bpp: i32, big: bool,
  rMax: i32, gMax: i32, bMax: i32,
  rShift: i32, gShift: i32, bShift: i32,
): u32 {
  const v = readPixelValue(src, offset, bpp, big);
  const r = <u32>scaleChannel(<i32>((v >>> rShift) & <u32>rMax), rMax);
  const g = <u32>scaleChannel(<i32>((v >>> gShift) & <u32>gMax), gMax);
  const b = <u32>scaleChannel(<i32>((v >>> bShift) & <u32>bMax), bMax);
  return r | (g << 8) | (b << 16) | (0xff000000);
}

// Write a packed RGBA pixel directly to the framebuffer
@inline
function fbSetPixel(x: i32, y: i32, packed: u32): void {
  const idx = (y * fbWidth + x) * 4;
  unchecked(fb[idx]     = <u8>(packed & 0xff));
  unchecked(fb[idx + 1] = <u8>((packed >> 8) & 0xff));
  unchecked(fb[idx + 2] = <u8>((packed >> 16) & 0xff));
  unchecked(fb[idx + 3] = <u8>((packed >> 24) & 0xff));
}

// Fill a rectangle in the framebuffer
function fbFillRect(x: i32, y: i32, w: i32, h: i32, packed: u32): void {
  for (let row: i32 = 0; row < h; row++) {
    for (let col: i32 = 0; col < w; col++) {
      fbSetPixel(x + col, y + row, packed);
    }
  }
}

// Blit raw RGBA tile (from a temporary Uint8Array) into the framebuffer
function fbBlitTile(dstX: i32, dstY: i32, tileW: i32, tileH: i32, tile: Uint8Array): void {
  for (let row: i32 = 0; row < tileH; row++) {
    const srcStart = row * tileW * 4;
    const dstStart = ((dstY + row) * fbWidth + dstX) * 4;
    for (let i: i32 = 0; i < tileW * 4; i++) {
      unchecked(fb[dstStart + i] = unchecked(tile[srcStart + i]));
    }
  }
}

// ─── Encoding 0: Raw ────────────────────────────────────────────

export function processRawRect(
  dataBuffer: ArrayBuffer,
  x: i32, y: i32, w: i32, h: i32,
  bitsPerPixel: i32, bigEndian: bool, trueColor: bool,
  rMax: i32, gMax: i32, bMax: i32,
  rShift: i32, gShift: i32, bShift: i32,
): i32 {
  if (!trueColor) return -1;
  let bpp = bitsPerPixel >> 3;
  if (bpp <= 0) bpp = 1;

  const src = Uint8Array.wrap(dataBuffer);
  const expected = w * h * bpp;
  if (src.length < expected) return -1;

  let srcOff: i32 = 0;
  for (let py: i32 = 0; py < h; py++) {
    for (let px: i32 = 0; px < w; px++) {
      const packed = decodePixel(src, srcOff, bpp, bigEndian, rMax, gMax, bMax, rShift, gShift, bShift);
      fbSetPixel(x + px, y + py, packed);
      srcOff += bpp;
    }
  }
  return 0;
}

// ─── Encoding 1: CopyRect ───────────────────────────────────────

export function processCopyRect(
  dstX: i32, dstY: i32, w: i32, h: i32,
  srcX: i32, srcY: i32,
): i32 {
  // Need a temporary buffer to avoid overlap issues
  const tmp = new Uint8Array(w * h * 4);
  for (let row: i32 = 0; row < h; row++) {
    const srcStart = ((srcY + row) * fbWidth + srcX) * 4;
    const tmpStart = row * w * 4;
    for (let i: i32 = 0; i < w * 4; i++) {
      unchecked(tmp[tmpStart + i] = unchecked(fb[srcStart + i]));
    }
  }
  for (let row: i32 = 0; row < h; row++) {
    const dstStart = ((dstY + row) * fbWidth + dstX) * 4;
    const tmpStart = row * w * 4;
    for (let i: i32 = 0; i < w * 4; i++) {
      unchecked(fb[dstStart + i] = unchecked(tmp[tmpStart + i]));
    }
  }
  return 0;
}

// ─── Encoding 2: RRE ────────────────────────────────────────────

export function processRreRect(
  dataBuffer: ArrayBuffer,
  x: i32, y: i32, w: i32, h: i32,
  bitsPerPixel: i32, bigEndian: bool, trueColor: bool,
  rMax: i32, gMax: i32, bMax: i32,
  rShift: i32, gShift: i32, bShift: i32,
): i32 {
  if (!trueColor) return -1;
  let bpp = bitsPerPixel >> 3;
  if (bpp <= 0) bpp = 1;

  const src = Uint8Array.wrap(dataBuffer);
  if (src.length < 4 + bpp) return -1;

  const subrectCount: i32 = (<i32>unchecked(src[0]) << 24)
    | (<i32>unchecked(src[1]) << 16)
    | (<i32>unchecked(src[2]) << 8)
    | <i32>unchecked(src[3]);

  let cursor: i32 = 4;

  // Background
  const bgPacked = decodePixel(src, cursor, bpp, bigEndian, rMax, gMax, bMax, rShift, gShift, bShift);
  cursor += bpp;
  fbFillRect(x, y, w, h, bgPacked);

  // Subrects
  for (let i: i32 = 0; i < subrectCount; i++) {
    if (src.length < cursor + bpp + 8) return -1;
    const fgPacked = decodePixel(src, cursor, bpp, bigEndian, rMax, gMax, bMax, rShift, gShift, bShift);
    cursor += bpp;

    const sx: i32 = (<i32>unchecked(src[cursor]) << 8) | <i32>unchecked(src[cursor + 1]);
    const sy: i32 = (<i32>unchecked(src[cursor + 2]) << 8) | <i32>unchecked(src[cursor + 3]);
    const sw: i32 = (<i32>unchecked(src[cursor + 4]) << 8) | <i32>unchecked(src[cursor + 5]);
    const sh: i32 = (<i32>unchecked(src[cursor + 6]) << 8) | <i32>unchecked(src[cursor + 7]);
    cursor += 8;

    fbFillRect(x + sx, y + sy, sw, sh, fgPacked);
  }
  return 0;
}

// ─── Encoding 4: CoRRE ───────────────────────────────────────────

export function processCoRreRect(
  dataBuffer: ArrayBuffer,
  x: i32, y: i32, w: i32, h: i32,
  bitsPerPixel: i32, bigEndian: bool, trueColor: bool,
  rMax: i32, gMax: i32, bMax: i32,
  rShift: i32, gShift: i32, bShift: i32,
): i32 {
  if (!trueColor) return -1;
  let bpp = bitsPerPixel >> 3;
  if (bpp <= 0) bpp = 1;

  const src = Uint8Array.wrap(dataBuffer);
  if (src.length < 4 + bpp) return -1;

  const subrectCount: i32 = (<i32>unchecked(src[0]) << 24)
    | (<i32>unchecked(src[1]) << 16)
    | (<i32>unchecked(src[2]) << 8)
    | <i32>unchecked(src[3]);

  let cursor: i32 = 4;
  const bgPacked = decodePixel(src, cursor, bpp, bigEndian, rMax, gMax, bMax, rShift, gShift, bShift);
  cursor += bpp;
  fbFillRect(x, y, w, h, bgPacked);

  for (let i: i32 = 0; i < subrectCount; i++) {
    if (src.length < cursor + bpp + 4) return -1;
    const fgPacked = decodePixel(src, cursor, bpp, bigEndian, rMax, gMax, bMax, rShift, gShift, bShift);
    cursor += bpp;

    const sx: i32 = <i32>unchecked(src[cursor++]);
    const sy: i32 = <i32>unchecked(src[cursor++]);
    const sw: i32 = <i32>unchecked(src[cursor++]);
    const sh: i32 = <i32>unchecked(src[cursor++]);
    fbFillRect(x + sx, y + sy, sw, sh, fgPacked);
  }
  return 0;
}

// ─── Encoding 5: Hextile ────────────────────────────────────────

export function processHextileRect(
  dataBuffer: ArrayBuffer,
  x: i32, y: i32, w: i32, h: i32,
  bitsPerPixel: i32, bigEndian: bool, trueColor: bool,
  rMax: i32, gMax: i32, bMax: i32,
  rShift: i32, gShift: i32, bShift: i32,
): i32 {
  if (!trueColor) return -1;
  let bpp = bitsPerPixel >> 3;
  if (bpp <= 0) bpp = 1;

  const src = Uint8Array.wrap(dataBuffer);
  let cursor: i32 = 0;
  let background: u32 = 0xff000000; // black, opaque
  let foreground: u32 = 0xffffffff; // white, opaque

  for (let tileY: i32 = 0; tileY < h; tileY += 16) {
    const tileH = min(16, h - tileY);
    for (let tileX: i32 = 0; tileX < w; tileX += 16) {
      const tileW = min(16, w - tileX);
      if (src.length < cursor + 1) return -1;
      const sub: i32 = <i32>unchecked(src[cursor++]);

      // Raw tile
      if (sub & 0x01) {
        const rawLen = tileW * tileH * bpp;
        if (src.length < cursor + rawLen) return -1;
        let so: i32 = cursor;
        for (let py: i32 = 0; py < tileH; py++) {
          for (let px: i32 = 0; px < tileW; px++) {
            const packed = decodePixel(src, so, bpp, bigEndian, rMax, gMax, bMax, rShift, gShift, bShift);
            fbSetPixel(x + tileX + px, y + tileY + py, packed);
            so += bpp;
          }
        }
        cursor += rawLen;
        continue;
      }

      // Background specified
      if (sub & 0x02) {
        if (src.length < cursor + bpp) return -1;
        background = decodePixel(src, cursor, bpp, bigEndian, rMax, gMax, bMax, rShift, gShift, bShift);
        cursor += bpp;
      }
      fbFillRect(x + tileX, y + tileY, tileW, tileH, background);

      // Foreground specified
      if (sub & 0x04) {
        if (src.length < cursor + bpp) return -1;
        foreground = decodePixel(src, cursor, bpp, bigEndian, rMax, gMax, bMax, rShift, gShift, bShift);
        cursor += bpp;
      }

      // Subrects
      if (sub & 0x08) {
        if (src.length < cursor + 1) return -1;
        const count: i32 = <i32>unchecked(src[cursor++]);
        for (let i: i32 = 0; i < count; i++) {
          let color = foreground;
          if (sub & 0x10) {
            if (src.length < cursor + bpp) return -1;
            color = decodePixel(src, cursor, bpp, bigEndian, rMax, gMax, bMax, rShift, gShift, bShift);
            cursor += bpp;
          }
          if (src.length < cursor + 2) return -1;
          const xy: i32 = <i32>unchecked(src[cursor++]);
          const wh: i32 = <i32>unchecked(src[cursor++]);
          fbFillRect(
            x + tileX + (xy >> 4),
            y + tileY + (xy & 0x0f),
            (wh >> 4) + 1,
            (wh & 0x0f) + 1,
            color,
          );
        }
      }
    }
  }
  return 0;
}

// ─── Encoding 16: ZRLE (decompressed tile data) ─────────────────
// JS handles zlib decompression; WASM receives the inflated payload.

export function processZrleTileData(
  decompressedBuffer: ArrayBuffer,
  x: i32, y: i32, w: i32, h: i32,
  bitsPerPixel: i32, bigEndian: bool, trueColor: bool,
  rMax: i32, gMax: i32, bMax: i32,
  rShift: i32, gShift: i32, bShift: i32,
): i32 {
  if (!trueColor) return -1;
  let bpp = bitsPerPixel >> 3;
  if (bpp <= 0) bpp = 1;

  const src = Uint8Array.wrap(decompressedBuffer);
  let cursor: i32 = 0;

  for (let tileY: i32 = 0; tileY < h; tileY += 64) {
    const tileH = min(64, h - tileY);
    for (let tileX: i32 = 0; tileX < w; tileX += 64) {
      const tileW = min(64, w - tileX);
      if (src.length < cursor + 1) return -1;
      const subenc: i32 = <i32>unchecked(src[cursor++]);
      const paletteSize = subenc & 0x7f;
      const rle = (subenc & 0x80) != 0;

      // Subencoding 0: raw pixels
      if (!rle && paletteSize == 0) {
        const rawLen = tileW * tileH * bpp;
        if (src.length < cursor + rawLen) return -1;
        let so: i32 = cursor;
        for (let py: i32 = 0; py < tileH; py++) {
          for (let px: i32 = 0; px < tileW; px++) {
            fbSetPixel(x + tileX + px, y + tileY + py,
              decodePixel(src, so, bpp, bigEndian, rMax, gMax, bMax, rShift, gShift, bShift));
            so += bpp;
          }
        }
        cursor += rawLen;
        continue;
      }

      // Subencoding 1: solid fill
      if (!rle && paletteSize == 1) {
        if (src.length < cursor + bpp) return -1;
        const packed = decodePixel(src, cursor, bpp, bigEndian, rMax, gMax, bMax, rShift, gShift, bShift);
        cursor += bpp;
        fbFillRect(x + tileX, y + tileY, tileW, tileH, packed);
        continue;
      }

      // Packed palette (2–16 colours, no RLE)
      if (!rle && paletteSize > 1) {
        const palette = new StaticArray<u32>(paletteSize);
        for (let i: i32 = 0; i < paletteSize; i++) {
          if (src.length < cursor + bpp) return -1;
          unchecked(palette[i] = decodePixel(src, cursor, bpp, bigEndian, rMax, gMax, bMax, rShift, gShift, bShift));
          cursor += bpp;
        }
        const bitsPerIdx: i32 = paletteSize <= 2 ? 1 : paletteSize <= 4 ? 2 : 4;
        const rowBytes: i32 = ((tileW * bitsPerIdx + 7) >> 3);
        const packedLen = rowBytes * tileH;
        if (src.length < cursor + packedLen) return -1;
        for (let row: i32 = 0; row < tileH; row++) {
          const rowStart = cursor + row * rowBytes;
          for (let col: i32 = 0; col < tileW; col++) {
            const bitIdx = col * bitsPerIdx;
            const byteIdx = rowStart + (bitIdx >> 3);
            const shift = 8 - bitsPerIdx - (bitIdx & 7);
            const palIdx = (<i32>unchecked(src[byteIdx]) >> shift) & ((1 << bitsPerIdx) - 1);
            fbSetPixel(x + tileX + col, y + tileY + row, unchecked(palette[palIdx]));
          }
        }
        cursor += packedLen;
        continue;
      }

      // Plain RLE (palette == 0, RLE flag)
      if (rle && paletteSize == 0) {
        let px: i32 = 0;
        let py: i32 = 0;
        while (py < tileH) {
          if (src.length < cursor + bpp) return -1;
          const packed = decodePixel(src, cursor, bpp, bigEndian, rMax, gMax, bMax, rShift, gShift, bShift);
          cursor += bpp;
          let runLen: i32 = 1;
          while (true) {
            if (src.length < cursor + 1) return -1;
            const val: i32 = <i32>unchecked(src[cursor++]);
            runLen += val;
            if (val != 255) break;
          }
          for (let r: i32 = 0; r < runLen; r++) {
            fbSetPixel(x + tileX + px, y + tileY + py, packed);
            px++;
            if (px >= tileW) { px = 0; py++; if (py >= tileH) break; }
          }
        }
        continue;
      }

      // Palette RLE (palette > 0, RLE flag)
      if (rle && paletteSize > 0) {
        const palette = new StaticArray<u32>(paletteSize);
        for (let i: i32 = 0; i < paletteSize; i++) {
          if (src.length < cursor + bpp) return -1;
          unchecked(palette[i] = decodePixel(src, cursor, bpp, bigEndian, rMax, gMax, bMax, rShift, gShift, bShift));
          cursor += bpp;
        }
        let px: i32 = 0;
        let py: i32 = 0;
        while (py < tileH) {
          if (src.length < cursor + 1) return -1;
          const idxByte: i32 = <i32>unchecked(src[cursor++]);
          let palIdx = idxByte;
          let runLen: i32 = 1;
          if (idxByte & 0x80) {
            palIdx = idxByte & 0x7f;
            runLen = 1;
            while (true) {
              if (src.length < cursor + 1) return -1;
              const val: i32 = <i32>unchecked(src[cursor++]);
              runLen += val;
              if (val != 255) break;
            }
          }
          const packed = unchecked(palette[palIdx]);
          for (let r: i32 = 0; r < runLen; r++) {
            fbSetPixel(x + tileX + px, y + tileY + py, packed);
            px++;
            if (px >= tileW) { px = 0; py++; if (py >= tileH) break; }
          }
        }
        continue;
      }

      return -1; // unknown subencoding
    }
  }
  return 0;
}

// ─── Legacy standalone decoder (kept for backward compat) ───────
// Returns a new ArrayBuffer with RGBA — used by the test harness
// and as a fallback for non-pipeline callers.

export function decodeRawRectToRgba(
  srcBuffer: ArrayBuffer,
  width: i32, height: i32,
  bitsPerPixel: i32, bigEndian: bool, trueColor: bool,
  redMax: i32, greenMax: i32, blueMax: i32,
  redShift: i32, greenShift: i32, blueShift: i32,
): ArrayBuffer {
  if (!trueColor) return new ArrayBuffer(0);
  let bpp = bitsPerPixel >> 3;
  if (bpp <= 0) bpp = 1;
  const pixels = width * height;
  const src = Uint8Array.wrap(srcBuffer);
  if (src.length < pixels * bpp) return new ArrayBuffer(0);
  const outBuf = new ArrayBuffer(pixels * 4);
  const out = Uint8Array.wrap(outBuf);
  let srcOff: i32 = 0;
  let dstOff: i32 = 0;
  for (let i: i32 = 0; i < pixels; i++) {
    const v = readPixelValue(src, srcOff, bpp, bigEndian);
    unchecked(out[dstOff]     = scaleChannel(<i32>((v >>> redShift) & <u32>redMax), redMax));
    unchecked(out[dstOff + 1] = scaleChannel(<i32>((v >>> greenShift) & <u32>greenMax), greenMax));
    unchecked(out[dstOff + 2] = scaleChannel(<i32>((v >>> blueShift) & <u32>blueMax), blueMax));
    unchecked(out[dstOff + 3] = 255);
    srcOff += bpp;
    dstOff += 4;
  }
  return outBuf;
}
