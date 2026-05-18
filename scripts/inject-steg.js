// NOTE: This script implements an alternative SHA256-PRNG based steganography 
// injection mechanism. It is currently retained for the signing verification 
// flow but is separate from the primary prime-stride LSB payload steganography 
// used in the main compilation pipeline (scrambler.ts).

const fs = require('fs');
const path = require('path');
const { Jimp } = require('jimp');
const crypto = require('crypto');

const MAGIC_SEED = 0xAAB011CC;

class Sha256Prng {
    constructor(seed) {
        this.counter = 0n;
        this.seed = BigInt(seed);
        this.buffer = Buffer.alloc(0);
        this.bufferIdx = 0;
    }

    next() {
        if (this.bufferIdx >= this.buffer.length) {
            const seedBuf = Buffer.alloc(4);
            seedBuf.writeUInt32LE(Number(this.seed));
            
            const counterBuf = Buffer.alloc(8);
            counterBuf.writeBigUInt64LE(this.counter);
            
            const hash = crypto.createHash('sha256');
            hash.update(seedBuf);
            hash.update(counterBuf);
            this.buffer = hash.digest();
            
            this.counter++;
            this.bufferIdx = 0;
        }

        const val = this.buffer.readUInt32LE(this.bufferIdx);
        this.bufferIdx += 4;
        return val;
    }
}

async function inject() {
    console.log('--- Phase 4: Steganography Injection ---');
    const imagePath = path.resolve(__dirname, '../../public/logo.png');
    
    if (!fs.existsSync(imagePath)) {
        console.error(`Image not found at ${imagePath}`);
        process.exit(1);
    }

    const keyPath = path.resolve(__dirname, '../../steg.key.hex');
    let keyHex;
    if (fs.existsSync(keyPath)) {
        keyHex = fs.readFileSync(keyPath, 'utf8').trim();
    } else {
        keyHex = crypto.randomBytes(32).toString('hex');
        fs.writeFileSync(keyPath, keyHex);
    }
    
    const keyBytes = Buffer.from(keyHex, 'hex');
    
    try {
        const image = await Jimp.read(imagePath);
        const width = image.bitmap.width;
        const height = image.bitmap.height;
        const totalPixels = width * height;

        if (totalPixels < 256) {
            console.error('Image too small to hide 256 bits of key material.');
            process.exit(1);
        }

        const seed = (width ^ height ^ MAGIC_SEED) >>> 0;
        const prng = new Sha256Prng(seed);

        const indices = new Set();
        while (indices.size < 256) {
            const idx = prng.next() % totalPixels;
            indices.add(idx);
        }

        const indexArray = Array.from(indices);
        
        for (let i = 0; i < 256; i++) {
            const pixelIdx = indexArray[i];
            const byteIdx = Math.floor(i / 8);
            const bitIdx = i % 8;
            
            const bit = (keyBytes[byteIdx] >> bitIdx) & 1;
            
            // Jimp uses a 1D array of RGBA bytes like PNGJS
            const blueIdx = pixelIdx * 4 + 2;
            
            image.bitmap.data[blueIdx] = (image.bitmap.data[blueIdx] & 0xFE) | bit;
        }

        await image.write(imagePath);
        console.log(`Successfully injected 32-byte stego key into ${imagePath}`);
        console.log(`Key: ${keyHex}`);
    } catch (err) {
        console.error("Injection failed:", err);
    }
}

inject();
