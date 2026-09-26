import { deflateSync } from 'node:zlib';

const WIDTH = 720;
const HEIGHT = 280;
const CHANNELS = 3;

const GLYPHS: Record<string, string[]> = {
    '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
    '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
    '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
    '3': ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
    '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
    '5': ['11111', '10000', '10000', '11110', '00001', '00001', '11110'],
    '6': ['01110', '10000', '10000', '11110', '10001', '10001', '01110'],
    '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
    '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
    '9': ['01110', '10001', '10001', '01111', '00001', '00001', '01110'],
    'A': ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
    'B': ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
    'C': ['01111', '10000', '10000', '10000', '10000', '10000', '01111'],
    'D': ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
    'E': ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
    'F': ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
    'G': ['01111', '10000', '10000', '10111', '10001', '10001', '01111'],
    '-': ['00000', '00000', '00000', '11111', '00000', '00000', '00000'],
};

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
    const scaleX = 7;
    const scaleY = 12;
    const spacing = 7;
    const glyphWidth = 5 * scaleX;
    const textWidth = (token.length * glyphWidth) + ((token.length - 1) * spacing);
    const startX = Math.floor((WIDTH - textWidth) / 2);
    const startY = Math.floor((HEIGHT - (7 * scaleY)) / 2);

    [...token].forEach((character, characterIndex) => {
        const glyph = GLYPHS[character];
        if (!glyph) throw new Error(`Unsupported verification token character: ${character}`);
        glyph.forEach((row, rowIndex) => {
            [...row].forEach((pixel, columnIndex) => {
                if (pixel !== '1') return;
                fillRect(
                    pixels,
                    startX + (characterIndex * (glyphWidth + spacing)) + (columnIndex * scaleX),
                    startY + (rowIndex * scaleY),
                    scaleX,
                    scaleY,
                    [255, 255, 255],
                );
            });
        });
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
