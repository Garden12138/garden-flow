import { deflateSync, inflateSync } from 'node:zlib';
import {
    verificationGlyphCharacters,
    verificationGlyphWidth,
    verificationGlyphHeight,
    verificationGlyphMasksBase64,
} from './productVideoVerificationGlyphs.ts';

const WIDTH = 720;
const HEIGHT = 280;
const CHANNELS = 3;

const GLYPH_MASKS = inflateSync(Buffer.from(verificationGlyphMasksBase64, 'base64'));

const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let index = 0; index < table.length; index += 1) {
        let value = index;
        for (let bit = 0; bit < 8; bit += 1) {
            value = (value & 1) !== 0
                ? 0xedb88320 ^ (value >>> 1)
                : value >>> 1;
        }
        table[index] = value >>> 0;
    }
    return table;
})();

function crc32(buffer: Buffer): number {
    let crc = 0xffffffff;
    for (const byte of buffer) {
        crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
    const typeBuffer = Buffer.from(type, 'ascii');
    const output = Buffer.alloc(12 + data.length);
    output.writeUInt32BE(data.length, 0);
    typeBuffer.copy(output, 4);
    data.copy(output, 8);
    output.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 8 + data.length);
    return output;
}

function fillRect(
    pixels: Buffer,
    x: number,
    y: number,
    width: number,
    height: number,
    color: [number, number, number],
): void {
    const startX = Math.max(0, Math.floor(x));
    const startY = Math.max(0, Math.floor(y));
    const endX = Math.min(WIDTH, Math.ceil(x + width));
    const endY = Math.min(HEIGHT, Math.ceil(y + height));
    for (let row = startY; row < endY; row += 1) {
        for (let column = startX; column < endX; column += 1) {
            const offset = ((row * WIDTH) + column) * CHANNELS;
            pixels[offset] = color[0];
            pixels[offset + 1] = color[1];
            pixels[offset + 2] = color[2];
        }
    }
}

function drawToken(pixels: Buffer, token: string): void {
    const spacing = 4;
    const glyphWidth = verificationGlyphWidth;
    const textWidth = (token.length * glyphWidth) + ((token.length - 1) * spacing);
    const startX = Math.floor((WIDTH - textWidth) / 2);
    const startY = Math.floor((HEIGHT - verificationGlyphHeight) / 2);

    [...token].forEach((character, characterIndex) => {
        const glyphIndex = verificationGlyphCharacters.indexOf(character);
        if (glyphIndex < 0) throw new Error(`Unsupported verification token character: ${character}`);
        const glyphOffset = glyphIndex * glyphWidth * verificationGlyphHeight;
        for (let row = 0; row < verificationGlyphHeight; row += 1) {
            for (let column = 0; column < glyphWidth; column += 1) {
                const alpha = GLYPH_MASKS[glyphOffset + (row * glyphWidth) + column] / 255;
                const offset = (((startY + row) * WIDTH) + startX + (characterIndex * (glyphWidth + spacing)) + column) * CHANNELS;
                for (let channel = 0; channel < CHANNELS; channel += 1) {
                    pixels[offset + channel] = Math.round(pixels[offset + channel] * (1 - alpha) + 255 * alpha);
                }
            }
        }
    });
}

export function createProductVideoVerificationPng(token: string): Buffer {
    const normalizedToken = String(token || '').trim().toUpperCase();
    if (!/^GF-[0-9A-F]{12}$/.test(normalizedToken)) {
        throw new Error('Invalid product-video visual verification token');
    }

    const pixels = Buffer.alloc(WIDTH * HEIGHT * CHANNELS);
    fillRect(pixels, 0, 0, WIDTH, HEIGHT, [17, 24, 39]);
    fillRect(pixels, 0, 0, WIDTH, 18, [59, 130, 246]);
    fillRect(pixels, 0, HEIGHT - 18, WIDTH, 18, [59, 130, 246]);
    fillRect(pixels, 24, 38, WIDTH - 48, HEIGHT - 76, [31, 41, 55]);
    drawToken(pixels, normalizedToken);

    const scanlines = Buffer.alloc((WIDTH * CHANNELS + 1) * HEIGHT);
    for (let row = 0; row < HEIGHT; row += 1) {
        const scanlineOffset = row * (WIDTH * CHANNELS + 1);
        scanlines[scanlineOffset] = 0;
        pixels.copy(
            scanlines,
            scanlineOffset + 1,
            row * WIDTH * CHANNELS,
            (row + 1) * WIDTH * CHANNELS,
        );
    }

    const header = Buffer.alloc(13);
    header.writeUInt32BE(WIDTH, 0);
    header.writeUInt32BE(HEIGHT, 4);
    header[8] = 8;
    header[9] = 2;
    header[10] = 0;
    header[11] = 0;
    header[12] = 0;

    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        pngChunk('IHDR', header),
        pngChunk('IDAT', deflateSync(scanlines, { level: 9 })),
        pngChunk('IEND', Buffer.alloc(0)),
    ]);
}
