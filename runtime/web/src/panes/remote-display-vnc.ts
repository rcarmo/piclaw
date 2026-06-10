
import { Unzlib, zlibSync } from 'fflate';

import { buildVncPasswordAuthResponse } from './vnc-auth.js';

import type {
    RemoteDisplayPixelFormat,
    RemoteDisplayProtocolAdapter,
    RemoteDisplayProtocolEvent,
    RemoteDisplayProtocolReceiveResult,
    RemoteDisplayRect,
} from './remote-display-protocol.js';

const PROTOCOL = 'vnc';

function toEncodingValue(value) {
    return Number(value);
}

function normalizeEncodings(encodings): number[] {
    const raw = Array.isArray(encodings)
        ? encodings
        : typeof encodings === 'string'
            ? encodings
                .split(',')
                .map((item) => item.trim())
                .filter((item) => item.length > 0)
            : [];
    const values: number[] = [];
    const seen = new Set();
    for (const item of raw) {
        const value = toEncodingValue(item);
        if (!Number.isFinite(value)) continue;
        const normalized = Number(value);
        if (!seen.has(normalized)) {
            values.push(normalized);
            seen.add(normalized);
        }
    }
    if (values.length > 0) return values;
    return [16, 5, 2, 4, 1, 0, -239, -224, -223, -307, -308];
}

function toUint8Array(chunk) {
    if (chunk instanceof Uint8Array) return chunk;
    if (chunk instanceof ArrayBuffer) return new Uint8Array(chunk);
    if (ArrayBuffer.isView(chunk)) return new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    return new Uint8Array(0);
}

function concatBytes(a, b) {
    const left = toUint8Array(a);
    const right = toUint8Array(b);
    if (!left.byteLength) return new Uint8Array(right);
    if (!right.byteLength) return new Uint8Array(left);
    const merged = new Uint8Array(left.byteLength + right.byteLength);
    merged.set(left, 0);
    merged.set(right, left.byteLength);
    return merged;
}

function concatByteChunks(chunks) {
    let total = 0;
    for (const chunk of chunks || []) total += chunk?.byteLength || 0;
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks || []) {
        const bytes = toUint8Array(chunk);
        merged.set(bytes, offset);
        offset += bytes.byteLength;
    }
    return merged;
}

function createZrleInflater() {
    return (compressed) => {
        const payload = toUint8Array(compressed);
        try {
            const chunks = [];
            const inflator = new Unzlib((chunk) => {
                chunks.push(new Uint8Array(chunk));
            }) as Unzlib & { err?: number; msg?: string };
            inflator.push(payload, true);
            if (inflator.err) {
                throw new Error(inflator.msg || 'zlib decompression error');
            }
            return concatByteChunks(chunks);
        } catch (error) {
            try {
                const fallback = zlibSync(payload);
                return fallback instanceof Uint8Array ? fallback : new Uint8Array(fallback);
            } catch (fallbackError) {
                const message = fallbackError instanceof Error ? fallbackError.message : 'unexpected EOF';
                throw new Error(`unexpected EOF: ${message}`);
            }
        }
    };
}

function asciiBytes(text) {
    return new TextEncoder().encode(String(text || ''));
}

function bytesToAscii(bytes) {
    return new TextDecoder().decode(toUint8Array(bytes));
}

function parseVersionString(text) {
    const match = /^RFB (\d{3})\.(\d{3})\n$/.exec(String(text || ''));
    if (!match) return null;
    return {
        major: parseInt(match[1], 10),
        minor: parseInt(match[2], 10),
        text: match[0],
    };
}

function chooseClientVersion(serverVersion) {
    if (!serverVersion) return 'RFB 003.008\n';
    if (serverVersion.major > 3 || serverVersion.minor >= 8) return 'RFB 003.008\n';
    if (serverVersion.minor >= 7) return 'RFB 003.007\n';
    return 'RFB 003.003\n';
}

function parsePixelFormat(view, offset = 0) {
    return {
        bitsPerPixel: view.getUint8(offset),
        depth: view.getUint8(offset + 1),
        bigEndian: view.getUint8(offset + 2) === 1,
        trueColor: view.getUint8(offset + 3) === 1,
        redMax: view.getUint16(offset + 4, false),
        greenMax: view.getUint16(offset + 6, false),
        blueMax: view.getUint16(offset + 8, false),
        redShift: view.getUint8(offset + 10),
        greenShift: view.getUint8(offset + 11),
        blueShift: view.getUint8(offset + 12),
    };
}

function encodePixelFormat(format) {
    const buffer = new ArrayBuffer(20);
    const view = new DataView(buffer);
    view.setUint8(0, 0);
    view.setUint8(1, 0);
    view.setUint8(2, 0);
    view.setUint8(3, 0);
    view.setUint8(4, format.bitsPerPixel);
    view.setUint8(5, format.depth);
    view.setUint8(6, format.bigEndian ? 1 : 0);
    view.setUint8(7, format.trueColor ? 1 : 0);
    view.setUint16(8, format.redMax, false);
    view.setUint16(10, format.greenMax, false);
    view.setUint16(12, format.blueMax, false);
    view.setUint8(14, format.redShift);
    view.setUint8(15, format.greenShift);
    view.setUint8(16, format.blueShift);
    return new Uint8Array(buffer);
}

function buildSetEncodings(encodings) {
    const list = Array.isArray(encodings) ? encodings : [];
    const buffer = new ArrayBuffer(4 + list.length * 4);
    const view = new DataView(buffer);
    view.setUint8(0, 2);
    view.setUint8(1, 0);
    view.setUint16(2, list.length, false);
    let offset = 4;
    for (const encoding of list) {
        view.setInt32(offset, Number(encoding || 0), false);
        offset += 4;
    }
    return new Uint8Array(buffer);
}

function buildFramebufferUpdateRequest(incremental, width, height, x = 0, y = 0) {
    const buffer = new ArrayBuffer(10);
    const view = new DataView(buffer);
    view.setUint8(0, 3);
    view.setUint8(1, incremental ? 1 : 0);
    view.setUint16(2, x, false);
    view.setUint16(4, y, false);
    view.setUint16(6, Math.max(0, width || 0), false);
    view.setUint16(8, Math.max(0, height || 0), false);
    return new Uint8Array(buffer);
}

function scaleChannel(value, max) {
    const numericMax = Number(max || 0);
    if (numericMax <= 0) return 0;
    if (numericMax === 255) return value & 0xff;
    return Math.max(0, Math.min(255, Math.round(((value || 0) * 255) / numericMax)));
}

function readPixelValue(bytes, offset, bytesPerPixel, bigEndian) {
    if (bytesPerPixel === 1) return bytes[offset];
    if (bytesPerPixel === 2) {
        return bigEndian
            ? ((bytes[offset] << 8) | bytes[offset + 1]) >>> 0
            : (bytes[offset] | (bytes[offset + 1] << 8)) >>> 0;
    }
    if (bytesPerPixel === 3) {
        return bigEndian
            ? ((bytes[offset] << 16) | (bytes[offset + 1] << 8) | bytes[offset + 2]) >>> 0
            : (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16)) >>> 0;
    }
    if (bytesPerPixel === 4) {
        return bigEndian
            ? (((bytes[offset] << 24) >>> 0) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0
            : (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | ((bytes[offset + 3] << 24) >>> 0)) >>> 0;
    }
    return 0;
}

export function decodeRawRectToRgba(bytes, width, height, pixelFormat) {
    const format = pixelFormat || DEFAULT_CLIENT_PIXEL_FORMAT;
    const src = toUint8Array(bytes);
    const bytesPerPixel = Math.max(1, Math.floor(Number(format.bitsPerPixel || 0) / 8));
    const expected = Math.max(0, width || 0) * Math.max(0, height || 0) * bytesPerPixel;
    if (src.byteLength < expected) {
        throw new Error(`Incomplete raw rectangle payload: expected ${expected} byte(s), got ${src.byteLength}`);
    }
    if (!format.trueColor) {
        throw new Error('Indexed-colour VNC framebuffers are not supported yet.');
    }
    const rgba = new Uint8ClampedArray(Math.max(0, width || 0) * Math.max(0, height || 0) * 4);
    let srcOffset = 0;
    let dstOffset = 0;
    for (let i = 0; i < Math.max(0, width || 0) * Math.max(0, height || 0); i += 1) {
        const value = readPixelValue(src, srcOffset, bytesPerPixel, format.bigEndian);
        const red = scaleChannel((value >>> format.redShift) & format.redMax, format.redMax);
        const green = scaleChannel((value >>> format.greenShift) & format.greenMax, format.greenMax);
        const blue = scaleChannel((value >>> format.blueShift) & format.blueMax, format.blueMax);
        rgba[dstOffset] = red;
        rgba[dstOffset + 1] = green;
        rgba[dstOffset + 2] = blue;
        rgba[dstOffset + 3] = 255;
        srcOffset += bytesPerPixel;
        dstOffset += 4;
    }
    return rgba;
}

function decodePixelToRgba(bytes, offset, pixelFormat) {
    const format = pixelFormat || DEFAULT_CLIENT_PIXEL_FORMAT;
    const bytesPerPixel = Math.max(1, Math.floor(Number(format.bitsPerPixel || 0) / 8));
    if (bytes.byteLength < offset + bytesPerPixel) return null;
    const value = readPixelValue(bytes, offset, bytesPerPixel, format.bigEndian);
    return {
        rgba: [
            scaleChannel((value >>> format.redShift) & format.redMax, format.redMax),
            scaleChannel((value >>> format.greenShift) & format.greenMax, format.greenMax),
            scaleChannel((value >>> format.blueShift) & format.blueMax, format.blueMax),
            255,
        ],
        bytesPerPixel,
    };
}

function fillRgbaRect(surface, surfaceWidth, x, y, width, height, rgba) {
    if (!rgba) return;
    for (let row = 0; row < height; row += 1) {
        for (let col = 0; col < width; col += 1) {
            const dst = ((y + row) * surfaceWidth + (x + col)) * 4;
            surface[dst] = rgba[0];
            surface[dst + 1] = rgba[1];
            surface[dst + 2] = rgba[2];
            surface[dst + 3] = rgba[3];
        }
    }
}

function blitRgbaTile(surface, surfaceWidth, tileX, tileY, tileWidth, tileHeight, tileRgba) {
    for (let row = 0; row < tileHeight; row += 1) {
        const srcStart = row * tileWidth * 4;
        const dstStart = ((tileY + row) * surfaceWidth + tileX) * 4;
        surface.set(tileRgba.subarray(srcStart, srcStart + tileWidth * 4), dstStart);
    }
}

function parseZrleRunLength(bytes, offset) {
    let cursor = offset;
    let runLength = 1;
    while (true) {
        if (bytes.byteLength < cursor + 1) return null;
        const value = bytes[cursor++];
        runLength += value;
        if (value !== 255) break;
    }
    return { consumed: cursor - offset, runLength };
}

function parseZrleRect(bytes, offset, width, height, pixelFormat, decodeRawRect, inflateZrle) {
    const format = pixelFormat || DEFAULT_CLIENT_PIXEL_FORMAT;
    const bytesPerPixel = Math.max(1, Math.floor(Number(format.bitsPerPixel || 0) / 8));
    if (bytes.byteLength < offset + 4) return null;
    const compressedLength = new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, false);
    if (bytes.byteLength < offset + 4 + compressedLength) return null;
    const compressed = bytes.slice(offset + 4, offset + 4 + compressedLength);
    let decoded;
    try {
        decoded = inflateZrle(compressed);
    } catch {
        return {
            consumed: 4 + compressedLength,
            skipped: true,
        };
    }
    let cursor = 0;
    const rgba = new Uint8ClampedArray(Math.max(0, width || 0) * Math.max(0, height || 0) * 4);

    for (let tileY = 0; tileY < height; tileY += 64) {
        const tileHeight = Math.min(64, height - tileY);
        for (let tileX = 0; tileX < width; tileX += 64) {
            const tileWidth = Math.min(64, width - tileX);
            if (decoded.byteLength < cursor + 1) return null;
            const subencoding = decoded[cursor++];
            const paletteSize = subencoding & 0x7f;
            const runLengthEncoded = (subencoding & 0x80) !== 0;

            if (!runLengthEncoded && paletteSize === 0) {
                const rawLength = tileWidth * tileHeight * bytesPerPixel;
                if (decoded.byteLength < cursor + rawLength) return null;
                const tileRgba = decodeRawRect(decoded.slice(cursor, cursor + rawLength), tileWidth, tileHeight, format);
                cursor += rawLength;
                blitRgbaTile(rgba, width, tileX, tileY, tileWidth, tileHeight, tileRgba);
                continue;
            }

            if (!runLengthEncoded && paletteSize === 1) {
                const background = decodePixelToRgba(decoded, cursor, format);
                if (!background) return null;
                cursor += background.bytesPerPixel;
                fillRgbaRect(rgba, width, tileX, tileY, tileWidth, tileHeight, background.rgba);
                continue;
            }

            if (!runLengthEncoded && paletteSize > 1 && paletteSize <= 16) {
                const palette = [];
                for (let i = 0; i < paletteSize; i += 1) {
                    const color = decodePixelToRgba(decoded, cursor, format);
                    if (!color) return null;
                    cursor += color.bytesPerPixel;
                    palette.push(color.rgba);
                }
                const bitsPerIndex = paletteSize <= 2 ? 1 : paletteSize <= 4 ? 2 : 4;
                const rowBytes = Math.ceil((tileWidth * bitsPerIndex) / 8);
                const packedLength = rowBytes * tileHeight;
                if (decoded.byteLength < cursor + packedLength) return null;
                for (let row = 0; row < tileHeight; row += 1) {
                    const rowStart = cursor + row * rowBytes;
                    for (let col = 0; col < tileWidth; col += 1) {
                        const bitIndex = col * bitsPerIndex;
                        const byteIndex = rowStart + (bitIndex >> 3);
                        const shift = 8 - bitsPerIndex - (bitIndex & 7);
                        const paletteIndex = (decoded[byteIndex] >> shift) & ((1 << bitsPerIndex) - 1);
                        fillRgbaRect(rgba, width, tileX + col, tileY + row, 1, 1, palette[paletteIndex]);
                    }
                }
                cursor += packedLength;
                continue;
            }

            if (runLengthEncoded && paletteSize === 0) {
                let px = 0;
                let py = 0;
                while (py < tileHeight) {
                    const color = decodePixelToRgba(decoded, cursor, format);
                    if (!color) return null;
                    cursor += color.bytesPerPixel;
                    const run = parseZrleRunLength(decoded, cursor);
                    if (!run) return null;
                    cursor += run.consumed;
                    for (let i = 0; i < run.runLength; i += 1) {
                        fillRgbaRect(rgba, width, tileX + px, tileY + py, 1, 1, color.rgba);
                        px += 1;
                        if (px >= tileWidth) {
                            px = 0;
                            py += 1;
                            if (py >= tileHeight) break;
                        }
                    }
                }
                continue;
            }

            if (runLengthEncoded && paletteSize > 0) {
                const palette = [];
                for (let i = 0; i < paletteSize; i += 1) {
                    const color = decodePixelToRgba(decoded, cursor, format);
                    if (!color) return null;
                    cursor += color.bytesPerPixel;
                    palette.push(color.rgba);
                }
                let px = 0;
                let py = 0;
                while (py < tileHeight) {
                    if (decoded.byteLength < cursor + 1) return null;
                    const indexByte = decoded[cursor++];
                    let paletteIndex = indexByte;
                    let runLength = 1;
                    if (indexByte & 0x80) {
                        paletteIndex = indexByte & 0x7f;
                        const run = parseZrleRunLength(decoded, cursor);
                        if (!run) return null;
                        cursor += run.consumed;
                        runLength = run.runLength;
                    }
                    const color = palette[paletteIndex];
                    if (!color) return null;
                    for (let i = 0; i < runLength; i += 1) {
                        fillRgbaRect(rgba, width, tileX + px, tileY + py, 1, 1, color);
                        px += 1;
                        if (px >= tileWidth) {
                            px = 0;
                            py += 1;
                            if (py >= tileHeight) break;
                        }
                    }
                }
                continue;
            }

            // Unknown or unused ZRLE subencoding — cannot decode this tile.
            // Skip the entire rect rather than blocking the connection.
            return {
                consumed: 4 + compressedLength,
                skipped: true,
            };
        }
    }

    return {
        consumed: 4 + compressedLength,
        rgba,
        decompressed: decoded,
    };
}

function parseRreRect(bytes, offset, width, height, pixelFormat) {
    const format = pixelFormat || DEFAULT_CLIENT_PIXEL_FORMAT;
    const bytesPerPixel = Math.max(1, Math.floor(Number(format.bitsPerPixel || 0) / 8));
    if (bytes.byteLength < offset + 4 + bytesPerPixel) return null;

    const view = new DataView(bytes.buffer, bytes.byteOffset + offset, bytes.byteLength - offset);
    const subrectCount = view.getUint32(0, false);
    const totalSize = 4 + bytesPerPixel + subrectCount * (bytesPerPixel + 8);
    if (bytes.byteLength < offset + totalSize) return null;

    let cursor = offset + 4;
    const background = decodePixelToRgba(bytes, cursor, format);
    if (!background) return null;
    cursor += background.bytesPerPixel;

    const rgba = new Uint8ClampedArray(Math.max(0, width || 0) * Math.max(0, height || 0) * 4);
    fillRgbaRect(rgba, width, 0, 0, width, height, background.rgba);

    for (let i = 0; i < subrectCount; i += 1) {
        const color = decodePixelToRgba(bytes, cursor, format);
        if (!color) return null;
        cursor += color.bytesPerPixel;
        if (bytes.byteLength < cursor + 8) return null;
        const rectView = new DataView(bytes.buffer, bytes.byteOffset + cursor, 8);
        const x = rectView.getUint16(0, false);
        const y = rectView.getUint16(2, false);
        const rectWidth = rectView.getUint16(4, false);
        const rectHeight = rectView.getUint16(6, false);
        cursor += 8;
        fillRgbaRect(rgba, width, x, y, rectWidth, rectHeight, color.rgba);
    }

    return {
        consumed: cursor - offset,
        rgba,
    };
}

function parseCoRreRect(bytes, offset, width, height, pixelFormat) {
    const format = pixelFormat || DEFAULT_CLIENT_PIXEL_FORMAT;
    const bytesPerPixel = Math.max(1, Math.floor(Number(format.bitsPerPixel || 0) / 8));
    if (bytes.byteLength < offset + 4 + bytesPerPixel) return null;
    const view = new DataView(bytes.buffer, bytes.byteOffset + offset, bytes.byteLength - offset);
    const subrects = view.getUint32(0, false);
    let cursor = offset + 4;
    const background = decodePixelToRgba(bytes, cursor, format);
    if (!background) return null;
    cursor += background.bytesPerPixel;
    const needed = cursor + subrects * (bytesPerPixel + 4);
    if (bytes.byteLength < needed) return null;
    const rgba = new Uint8ClampedArray(Math.max(0, width || 0) * Math.max(0, height || 0) * 4);
    fillRgbaRect(rgba, width, 0, 0, width, height, background.rgba);
    for (let i = 0; i < subrects; i += 1) {
        const color = decodePixelToRgba(bytes, cursor, format);
        if (!color) return null;
        cursor += color.bytesPerPixel;
        const sx = bytes[cursor++];
        const sy = bytes[cursor++];
        const sw = bytes[cursor++];
        const sh = bytes[cursor++];
        fillRgbaRect(rgba, width, sx, sy, sw, sh, color.rgba);
    }
    return { consumed: cursor - offset, rgba };
}

function parseHextileRect(bytes, offset, width, height, pixelFormat, decodeRawRect) {
    const format = pixelFormat || DEFAULT_CLIENT_PIXEL_FORMAT;
    const bytesPerPixel = Math.max(1, Math.floor(Number(format.bitsPerPixel || 0) / 8));
    const rgba = new Uint8ClampedArray(Math.max(0, width || 0) * Math.max(0, height || 0) * 4);
    let cursor = offset;
    let background = [0, 0, 0, 255];
    let foreground = [255, 255, 255, 255];

    for (let tileY = 0; tileY < height; tileY += 16) {
        const tileHeight = Math.min(16, height - tileY);
        for (let tileX = 0; tileX < width; tileX += 16) {
            const tileWidth = Math.min(16, width - tileX);
            if (bytes.byteLength < cursor + 1) return null;
            const subencoding = bytes[cursor++];

            if (subencoding & 0x01) {
                const rawLength = tileWidth * tileHeight * bytesPerPixel;
                if (bytes.byteLength < cursor + rawLength) return null;
                const tileRgba = decodeRawRect(bytes.slice(cursor, cursor + rawLength), tileWidth, tileHeight, format);
                cursor += rawLength;
                blitRgbaTile(rgba, width, tileX, tileY, tileWidth, tileHeight, tileRgba);
                continue;
            }

            if (subencoding & 0x02) {
                const decoded = decodePixelToRgba(bytes, cursor, format);
                if (!decoded) return null;
                background = decoded.rgba;
                cursor += decoded.bytesPerPixel;
            }
            fillRgbaRect(rgba, width, tileX, tileY, tileWidth, tileHeight, background);

            if (subencoding & 0x04) {
                const decoded = decodePixelToRgba(bytes, cursor, format);
                if (!decoded) return null;
                foreground = decoded.rgba;
                cursor += decoded.bytesPerPixel;
            }

            if (subencoding & 0x08) {
                if (bytes.byteLength < cursor + 1) return null;
                const subrectCount = bytes[cursor++];
                for (let i = 0; i < subrectCount; i += 1) {
                    let color = foreground;
                    if (subencoding & 0x10) {
                        const decoded = decodePixelToRgba(bytes, cursor, format);
                        if (!decoded) return null;
                        color = decoded.rgba;
                        cursor += decoded.bytesPerPixel;
                    }
                    if (bytes.byteLength < cursor + 2) return null;
                    const xy = bytes[cursor++];
                    const wh = bytes[cursor++];
                    const subX = xy >> 4;
                    const subY = xy & 0x0f;
                    const subWidth = (wh >> 4) + 1;
                    const subHeight = (wh & 0x0f) + 1;
                    fillRgbaRect(rgba, width, tileX + subX, tileY + subY, subWidth, subHeight, color);
                }
            }
        }
    }

    return {
        consumed: cursor - offset,
        rgba,
    };
}

export const DEFAULT_CLIENT_PIXEL_FORMAT: RemoteDisplayPixelFormat = {
    bitsPerPixel: 32,
    depth: 24,
    bigEndian: false,
    trueColor: true,
    redMax: 255,
    greenMax: 255,
    blueMax: 255,
    redShift: 16,
    greenShift: 8,
    blueShift: 0,
};

export class VncRemoteDisplayProtocol implements RemoteDisplayProtocolAdapter {
    readonly protocol = PROTOCOL;
    state: string;
    framebufferWidth: number;
    framebufferHeight: number;
    serverName: string;
    [key: string]: any;

    constructor(options: Record<string, any> = {}) {
        this.shared = options.shared !== false;
        this.decodeRawRect = typeof options.decodeRawRect === 'function' ? options.decodeRawRect : decodeRawRectToRgba;
        this.pipeline = options.pipeline || null;
        this.encodings = normalizeEncodings(options.encodings || null);
        this.state = 'version';
        this.buffer = new Uint8Array(0);
        this.serverVersion = null;
        this.clientVersionText = null;
        this.framebufferWidth = 0;
        this.framebufferHeight = 0;
        this.serverName = '';
        this.serverPixelFormat = null;
        this.clientPixelFormat = { ...DEFAULT_CLIENT_PIXEL_FORMAT };
        this.password = typeof options.password === 'string' && options.password.length > 0 ? options.password : null;
        this.inflateZrle = typeof options.inflateZrle === 'function' ? options.inflateZrle : createZrleInflater();
    }

    receive(chunk) {
        if (chunk) {
            this.buffer = concatBytes(this.buffer, chunk);
        }
        const events: RemoteDisplayProtocolEvent[] = [];
        const outgoing: Uint8Array[] = [];
        let progressed = true;
        while (progressed) {
            progressed = false;

            if (this.state === 'version') {
                if (this.buffer.byteLength < 12) break;
                const bytes = this.consume(12);
                const text = bytesToAscii(bytes);
                const version = parseVersionString(text);
                if (!version) {
                    throw new Error(`Unsupported RFB version banner: ${text || '<empty>'}`);
                }
                this.serverVersion = version;
                this.clientVersionText = chooseClientVersion(version);
                outgoing.push(asciiBytes(this.clientVersionText));
                events.push({ type: 'protocol-version', protocol: PROTOCOL, server: version.text.trim(), client: this.clientVersionText.trim() });
                this.state = version.minor >= 7 ? 'security-types' : 'security-type-33';
                progressed = true;
                continue;
            }

            if (this.state === 'security-types') {
                if (this.buffer.byteLength < 1) break;
                const count = this.buffer[0];
                if (count === 0) {
                    if (this.buffer.byteLength < 5) break;
                    const view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
                    const reasonLength = view.getUint32(1, false);
                    if (this.buffer.byteLength < 5 + reasonLength) break;
                    this.consume(1);
                    const reason = bytesToAscii(this.consume(4 + reasonLength).slice(4));
                    throw new Error(reason || 'VNC server rejected the connection.');
                }
                if (this.buffer.byteLength < 1 + count) break;
                this.consume(1);
                const types = Array.from(this.consume(count) as Uint8Array) as number[];
                events.push({ type: 'security-types', protocol: PROTOCOL, types });
                let selectedType = null;
                if (types.includes(2) && this.password !== null) {
                    selectedType = 2;
                } else if (types.includes(1)) {
                    selectedType = 1;
                } else if (types.includes(2)) {
                    throw new Error('VNC password authentication is required. Enter a password and reconnect.');
                } else {
                    throw new Error(`Unsupported VNC security types: ${types.join(', ') || 'none'}. This viewer currently supports only "None" and password-based VNC auth.`);
                }
                outgoing.push(Uint8Array.of(selectedType));
                events.push({ type: 'security-selected', protocol: PROTOCOL, securityType: selectedType, label: selectedType === 2 ? 'VNC Authentication' : 'None' });
                this.state = selectedType === 2 ? 'security-challenge' : 'security-result';
                progressed = true;
                continue;
            }

            if (this.state === 'security-type-33') {
                if (this.buffer.byteLength < 4) break;
                const view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
                const securityType = view.getUint32(0, false);
                this.consume(4);
                if (securityType === 0) {
                    if (this.buffer.byteLength < 4) break;
                    const reasonView = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
                    const reasonLength = reasonView.getUint32(0, false);
                    if (this.buffer.byteLength < 4 + reasonLength) break;
                    const reason = bytesToAscii(this.consume(4 + reasonLength).slice(4));
                    throw new Error(reason || 'VNC server rejected the connection.');
                }
                if (securityType === 2) {
                    if (this.password === null) {
                        throw new Error('VNC password authentication is required. Enter a password and reconnect.');
                    }
                    events.push({ type: 'security-selected', protocol: PROTOCOL, securityType: 2, label: 'VNC Authentication' });
                    this.state = 'security-challenge';
                    progressed = true;
                    continue;
                }
                if (securityType !== 1) {
                    throw new Error(`Unsupported VNC security type ${securityType}. This viewer currently supports only "None" and password-based VNC auth.`);
                }
                events.push({ type: 'security-selected', protocol: PROTOCOL, securityType: 1, label: 'None' });
                outgoing.push(Uint8Array.of(this.shared ? 1 : 0));
                this.state = 'server-init';
                progressed = true;
                continue;
            }

            if (this.state === 'security-challenge') {
                if (this.buffer.byteLength < 16) break;
                if (this.password === null) {
                    throw new Error('VNC password authentication is required. Enter a password and reconnect.');
                }
                const challenge = this.consume(16);
                outgoing.push(buildVncPasswordAuthResponse(this.password, challenge));
                this.state = 'security-result';
                progressed = true;
                continue;
            }

            if (this.state === 'security-result') {
                if (this.buffer.byteLength < 4) break;
                const view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
                const result = view.getUint32(0, false);
                this.consume(4);
                if (result !== 0) {
                    if (this.buffer.byteLength >= 4) {
                        const reasonLength = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength).getUint32(0, false);
                        if (this.buffer.byteLength >= 4 + reasonLength) {
                            const reason = bytesToAscii(this.consume(4 + reasonLength).slice(4));
                            throw new Error(reason || 'VNC authentication failed.');
                        }
                    }
                    throw new Error('VNC authentication failed.');
                }
                events.push({ type: 'security-result', protocol: PROTOCOL, ok: true });
                outgoing.push(Uint8Array.of(this.shared ? 1 : 0));
                this.state = 'server-init';
                progressed = true;
                continue;
            }

            if (this.state === 'server-init') {
                if (this.buffer.byteLength < 24) break;
                const view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
                const width = view.getUint16(0, false);
                const height = view.getUint16(2, false);
                const pixelFormat = parsePixelFormat(view, 4);
                const nameLength = view.getUint32(20, false);
                if (this.buffer.byteLength < 24 + nameLength) break;
                const fixed = this.consume(24);
                const fixedView = new DataView(fixed.buffer, fixed.byteOffset, fixed.byteLength);
                this.framebufferWidth = fixedView.getUint16(0, false);
                this.framebufferHeight = fixedView.getUint16(2, false);
                this.serverPixelFormat = parsePixelFormat(fixedView, 4);
                this.serverName = bytesToAscii(this.consume(nameLength));
                this.state = 'connected';
                if (this.pipeline) {
                    this.pipeline.initFramebuffer(this.framebufferWidth, this.framebufferHeight);
                }
                outgoing.push(encodePixelFormat(this.clientPixelFormat));
                outgoing.push(buildSetEncodings(this.encodings));
                outgoing.push(buildFramebufferUpdateRequest(false, this.framebufferWidth, this.framebufferHeight));
                events.push({
                    type: 'display-init',
                    protocol: PROTOCOL,
                    width,
                    height,
                    name: this.serverName,
                    pixelFormat,
                });
                progressed = true;
                continue;
            }

            if (this.state === 'connected') {
                if (this.buffer.byteLength < 1) break;
                const type = this.buffer[0];
                if (type === 0) {
                    if (this.buffer.byteLength < 4) break;
                    const headerView = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
                    const numberOfRectangles = headerView.getUint16(2, false);
                    let offset = 4;
                    const rects: RemoteDisplayRect[] = [];
                    let incomplete = false;
                    const usePipeline = !!this.pipeline;
                    for (let i = 0; i < numberOfRectangles; i += 1) {
                        if (this.buffer.byteLength < offset + 12) {
                            incomplete = true;
                            break;
                        }
                        const rectView = new DataView(this.buffer.buffer, this.buffer.byteOffset + offset, 12);
                        const x = rectView.getUint16(0, false);
                        const y = rectView.getUint16(2, false);
                        const width = rectView.getUint16(4, false);
                        const height = rectView.getUint16(6, false);
                        const encoding = rectView.getInt32(8, false);
                        offset += 12;

                        // ── Raw (0) ──────────────────────────────
                        if (encoding === 0) {
                            const bytesPerPixel = Math.max(1, Math.floor(Number(this.clientPixelFormat.bitsPerPixel || 0) / 8));
                            const dataLength = width * height * bytesPerPixel;
                            if (this.buffer.byteLength < offset + dataLength) {
                                incomplete = true;
                                break;
                            }
                            const raw = this.buffer.slice(offset, offset + dataLength);
                            offset += dataLength;
                            if (usePipeline) {
                                this.pipeline.processRawRect(raw, x, y, width, height, this.clientPixelFormat);
                                rects.push({ kind: 'pipeline', x, y, width, height });
                            } else {
                                rects.push({
                                    kind: 'rgba',
                                    x, y, width, height,
                                    rgba: this.decodeRawRect(raw, width, height, this.clientPixelFormat),
                                });
                            }
                            continue;
                        }

                        // ── RRE (2) ──────────────────────────────
                        if (encoding === 2) {
                            const rre = parseRreRect(this.buffer, offset, width, height, this.clientPixelFormat);
                            if (!rre) {
                                incomplete = true;
                                break;
                            }
                            if (usePipeline) {
                                const rreData = this.buffer.slice(offset, offset + rre.consumed);
                                this.pipeline.processRreRect(rreData, x, y, width, height, this.clientPixelFormat);
                                rects.push({ kind: 'pipeline', x, y, width, height });
                            } else {
                                rects.push({ kind: 'rgba', x, y, width, height, rgba: rre.rgba });
                            }
                            offset += rre.consumed;
                            continue;
                        }

                        // ── CoRRE (4) ────────────────────────────
                        if (encoding === 4) {
                            const corre = parseCoRreRect(this.buffer, offset, width, height, this.clientPixelFormat);
                            if (!corre) {
                                incomplete = true;
                                break;
                            }
                            if (usePipeline && typeof this.pipeline.processCoRreRect === 'function') {
                                const correData = this.buffer.slice(offset, offset + corre.consumed);
                                this.pipeline.processCoRreRect(correData, x, y, width, height, this.clientPixelFormat);
                                rects.push({ kind: 'pipeline', x, y, width, height });
                            } else {
                                rects.push({ kind: 'rgba', x, y, width, height, rgba: corre.rgba });
                            }
                            offset += corre.consumed;
                            continue;
                        }

                        // ── CopyRect (1) ─────────────────────────
                        if (encoding === 1) {
                            if (this.buffer.byteLength < offset + 4) {
                                incomplete = true;
                                break;
                            }
                            const copyView = new DataView(this.buffer.buffer, this.buffer.byteOffset + offset, 4);
                            const srcX = copyView.getUint16(0, false);
                            const srcY = copyView.getUint16(2, false);
                            offset += 4;
                            if (usePipeline) {
                                this.pipeline.processCopyRect(x, y, width, height, srcX, srcY);
                                rects.push({ kind: 'pipeline', x, y, width, height });
                            } else {
                                rects.push({ kind: 'copy', x, y, width, height, srcX, srcY });
                            }
                            continue;
                        }

                        // ── ZRLE (16) ────────────────────────────
                        if (encoding === 16) {
                            const zrle = parseZrleRect(this.buffer, offset, width, height, this.clientPixelFormat, this.decodeRawRect, this.inflateZrle);
                            if (!zrle) {
                                incomplete = true;
                                break;
                            }
                            offset += zrle.consumed;
                            if (zrle.skipped) continue;
                            if (usePipeline && zrle.decompressed) {
                                this.pipeline.processZrleTileData(zrle.decompressed, x, y, width, height, this.clientPixelFormat);
                                rects.push({ kind: 'pipeline', x, y, width, height });
                            } else {
                                rects.push({ kind: 'rgba', x, y, width, height, rgba: zrle.rgba });
                            }
                            continue;
                        }

                        // ── Hextile (5) ──────────────────────────
                        if (encoding === 5) {
                            const hextile = parseHextileRect(this.buffer, offset, width, height, this.clientPixelFormat, this.decodeRawRect);
                            if (!hextile) {
                                incomplete = true;
                                break;
                            }
                            if (usePipeline) {
                                const hextileData = this.buffer.slice(offset, offset + hextile.consumed);
                                this.pipeline.processHextileRect(hextileData, x, y, width, height, this.clientPixelFormat);
                                rects.push({ kind: 'pipeline', x, y, width, height });
                            } else {
                                rects.push({ kind: 'rgba', x, y, width, height, rgba: hextile.rgba });
                            }
                            offset += hextile.consumed;
                            continue;
                        }

                        // ── LastRect (-224) ──────────────────────
                        if (encoding === -224) {
                            i = numberOfRectangles;
                            continue;
                        }

                        // ── DesktopName (-307) ───────────────────
                        if (encoding === -307) {
                            if (this.buffer.byteLength < offset + 4) {
                                incomplete = true;
                                break;
                            }
                            const nameLength = new DataView(this.buffer.buffer, this.buffer.byteOffset + offset, 4).getUint32(0, false);
                            if (this.buffer.byteLength < offset + 4 + nameLength) {
                                incomplete = true;
                                break;
                            }
                            const nameBytes = this.buffer.slice(offset + 4, offset + 4 + nameLength);
                            try { this.serverName = bytesToAscii(nameBytes); } catch { /* ignore */ }
                            rects.push({ kind: 'desktop-name', name: this.serverName });
                            offset += 4 + nameLength;
                            continue;
                        }

                        // ── ExtendedDesktopSize (-308) ────────────
                        if (encoding === -308) {
                            if (this.buffer.byteLength < offset + 4) {
                                incomplete = true;
                                break;
                            }
                            const screenCount = this.buffer[offset];
                            const payloadLength = 4 + Math.max(0, screenCount) * 16;
                            if (this.buffer.byteLength < offset + payloadLength) {
                                incomplete = true;
                                break;
                            }
                            this.framebufferWidth = width;
                            this.framebufferHeight = height;
                            if (usePipeline) {
                                this.pipeline.initFramebuffer(width, height);
                            }
                            rects.push({ kind: 'resize', x, y, width, height });
                            offset += payloadLength;
                            continue;
                        }

                        // ── Cursor (-239) ─────────────────────────
                        if (encoding === -239) {
                            const bytesPerPixel = Math.max(1, Math.floor(Number(this.clientPixelFormat.bitsPerPixel || 0) / 8));
                            const pixelLength = width * height * bytesPerPixel;
                            const maskLength = Math.ceil(width / 8) * height;
                            if (this.buffer.byteLength < offset + pixelLength + maskLength) {
                                incomplete = true;
                                break;
                            }
                            const pixelBytes = this.buffer.slice(offset, offset + pixelLength);
                            const maskBytes = this.buffer.slice(offset + pixelLength, offset + pixelLength + maskLength);
                            const rgba = this.decodeRawRect(pixelBytes, width, height, this.clientPixelFormat);
                            for (let cy = 0; cy < height; cy += 1) {
                                for (let cx = 0; cx < width; cx += 1) {
                                    const maskByte = maskBytes[cy * Math.ceil(width / 8) + Math.floor(cx / 8)] || 0;
                                    const visible = (maskByte & (128 >> (cx % 8))) !== 0;
                                    rgba[(cy * width + cx) * 4 + 3] = visible ? rgba[(cy * width + cx) * 4 + 3] : 0;
                                }
                            }
                            rects.push({ kind: 'cursor', x, y, width, height, rgba });
                            offset += pixelLength + maskLength;
                            continue;
                        }

                        // ── DesktopSize (-223) ───────────────────
                        if (encoding === -223) {
                            this.framebufferWidth = width;
                            this.framebufferHeight = height;
                            if (usePipeline) {
                                this.pipeline.initFramebuffer(width, height);
                            }
                            rects.push({ kind: 'resize', x, y, width, height });
                            continue;
                        }
                        throw new Error(`Unsupported VNC rectangle encoding ${encoding}. This viewer currently supports ZRLE, Hextile, RRE, CoRRE, CopyRect, Cursor, LastRect, DesktopName, ExtendedDesktopSize, raw rectangles, and DesktopSize only.`);
                    }
                    if (incomplete) break;
                    this.consume(offset);

                    // If pipeline mode, attach the WASM framebuffer snapshot
                    const event: any = {
                        type: 'framebuffer-update',
                        protocol: PROTOCOL,
                        width: this.framebufferWidth,
                        height: this.framebufferHeight,
                        rects,
                    };
                    if (usePipeline) {
                        event.framebuffer = this.pipeline.getFramebuffer();
                    }
                    events.push(event);
                    outgoing.push(buildFramebufferUpdateRequest(true, this.framebufferWidth, this.framebufferHeight));
                    progressed = true;
                    continue;
                }
                if (type === 2) {
                    this.consume(1);
                    events.push({ type: 'bell', protocol: PROTOCOL });
                    progressed = true;
                    continue;
                }
                if (type === 3) {
                    if (this.buffer.byteLength < 8) break;
                    const view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
                    const length = view.getUint32(4, false);
                    if (this.buffer.byteLength < 8 + length) break;
                    this.consume(8);
                    const text = bytesToAscii(this.consume(length));
                    events.push({ type: 'clipboard', protocol: PROTOCOL, text });
                    progressed = true;
                    continue;
                }
                throw new Error(`Unsupported VNC server message type ${type}.`);
            }
        }
        return { events, outgoing } as RemoteDisplayProtocolReceiveResult;
    }

    consume(length) {
        const chunk = this.buffer.slice(0, length);
        this.buffer = this.buffer.slice(length);
        return chunk;
    }
}
