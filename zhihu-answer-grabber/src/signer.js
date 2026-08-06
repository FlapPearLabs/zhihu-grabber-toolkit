/*
 * x-zse-96 签名器。
 * Derived from zse-signer.js in iteng007/zhihu-mcp-server (https://github.com/iteng007/zhihu-mcp-server),
 * which is a port of the zse96 v2 signing algorithm from zly2006/zhihu-plus-plus (https://github.com/zly2006/zhihu-plus-plus).
 * Copyright their respective contributors.
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import crypto from 'node:crypto';

const ZK = new Uint32Array([
  1170614578, 1024848638, 1413669199, 3951632832, 3528873006, 2921909214, 4151847688, 3997739139,
  1933479194, 3323781115, 3888513386, 460404854, 3747539722, 2403641034, 2615871395, 2119585428,
  2265697227, 2035090028, 2773447226, 4289380121, 4217216195, 2200601443, 3051914490, 1579901135,
  1321810770, 456816404, 2903323407, 4065664991, 330002838, 3506006750, 363569021, 2347096187,
]);

const ZB = new Uint8Array([
  20, 223, 245, 7, 248, 2, 194, 209, 87, 6, 227, 253, 240, 128, 222, 91, 237, 9, 125, 157, 230,
  93, 252, 205, 90, 79, 144, 199, 159, 197, 186, 167, 39, 37, 156, 198, 38, 42, 43, 168, 217,
  153, 15, 103, 80, 189, 71, 191, 97, 84, 247, 95, 36, 69, 14, 35, 12, 171, 28, 114, 178, 148,
  86, 182, 32, 83, 158, 109, 22, 255, 94, 238, 151, 85, 77, 124, 254, 18, 4, 26, 123, 176, 232,
  193, 131, 172, 143, 142, 150, 30, 10, 146, 162, 62, 224, 218, 196, 229, 1, 192, 213, 27, 110,
  56, 231, 180, 138, 107, 242, 187, 54, 120, 19, 44, 117, 228, 215, 203, 53, 239, 251, 127, 81,
  11, 133, 96, 204, 132, 41, 115, 73, 55, 249, 147, 102, 48, 122, 145, 106, 118, 74, 190, 29, 16,
  174, 5, 177, 129, 63, 113, 99, 31, 161, 76, 246, 34, 211, 13, 60, 68, 207, 160, 65, 111, 82,
  165, 67, 169, 225, 57, 112, 244, 155, 51, 236, 200, 233, 58, 61, 47, 100, 137, 185, 64, 17, 70,
  234, 163, 219, 108, 170, 166, 59, 149, 52, 105, 24, 212, 78, 173, 45, 0, 116, 226, 119, 136,
  206, 135, 175, 195, 25, 92, 121, 208, 126, 139, 3, 75, 141, 21, 130, 98, 241, 40, 154, 66, 184,
  49, 181, 46, 243, 88, 101, 183, 8, 23, 72, 188, 104, 179, 210, 134, 250, 201, 164, 89, 216,
  202, 220, 50, 221, 152, 140, 33, 235, 214,
]);

const ALPHABET = '6fpLRqJO8M/c3jnYxFkUVC4ZIG12SiH=5v0mXDazWBTsuw7QetbKdoPyAl+hN9rgE';
const KEY16 = Buffer.from('059053f7d15e01d7', 'utf8');

function readU32Be(bytes, offset) {
  return ((bytes[offset] & 0xff) << 24)
    | ((bytes[offset + 1] & 0xff) << 16)
    | ((bytes[offset + 2] & 0xff) << 8)
    | (bytes[offset + 3] & 0xff);
}

function writeU32Be(value, output, offset) {
  output[offset] = (value >>> 24) & 0xff;
  output[offset + 1] = (value >>> 16) & 0xff;
  output[offset + 2] = (value >>> 8) & 0xff;
  output[offset + 3] = value & 0xff;
}

function rotateLeft(value, bits) {
  return ((value << bits) | (value >>> (32 - bits))) >>> 0;
}

function transform(value) {
  const mixed = ((ZB[(value >>> 24) & 0xff] & 0xff) << 24)
    | ((ZB[(value >>> 16) & 0xff] & 0xff) << 16)
    | ((ZB[(value >>> 8) & 0xff] & 0xff) << 8)
    | (ZB[value & 0xff] & 0xff);
  return (mixed ^ rotateLeft(mixed, 2) ^ rotateLeft(mixed, 10)
    ^ rotateLeft(mixed, 18) ^ rotateLeft(mixed, 24)) >>> 0;
}

function encryptBlock(input) {
  const rounds = new Uint32Array(36);
  for (let index = 0; index < 4; index += 1) rounds[index] = readU32Be(input, index * 4);
  for (let index = 0; index < 32; index += 1) {
    const value = (rounds[index + 1] ^ rounds[index + 2] ^ rounds[index + 3] ^ ZK[index]) >>> 0;
    rounds[index + 4] = (rounds[index] ^ transform(value)) >>> 0;
  }
  const output = Buffer.alloc(16);
  writeU32Be(rounds[35], output, 0);
  writeU32Be(rounds[34], output, 4);
  writeU32Be(rounds[33], output, 8);
  writeU32Be(rounds[32], output, 12);
  return output;
}

function encryptBlocks(data, initialVector) {
  let vector = Buffer.from(initialVector);
  const output = Buffer.alloc(data.length);
  for (let offset = 0; offset < data.length; offset += 16) {
    const mixed = Buffer.alloc(16);
    for (let index = 0; index < 16; index += 1) mixed[index] = data[offset + index] ^ vector[index];
    vector = encryptBlock(mixed);
    vector.copy(output, offset);
  }
  return output;
}

function customEncode(input) {
  let bytes = Buffer.from(input);
  const remainder = bytes.length % 3;
  if (remainder !== 0) bytes = Buffer.concat([bytes, Buffer.alloc(3 - remainder)]);
  let output = '';
  let maskIndex = 0;

  for (let offset = bytes.length - 1; offset >= 0; offset -= 3) {
    let value = 0;
    for (let byteIndex = 0; byteIndex < 3; byteIndex += 1) {
      const mask = (58 >>> (8 * (maskIndex % 4))) & 0xff;
      value |= ((bytes[offset - byteIndex] ^ mask) & 0xff) << (byteIndex * 8);
      maskIndex += 1;
    }
    output += ALPHABET[value & 63];
    output += ALPHABET[(value >>> 6) & 63];
    output += ALPHABET[(value >>> 12) & 63];
    output += ALPHABET[(value >>> 18) & 63];
  }
  return output;
}

function encryptZseV4(input) {
  const encoded = encodeURIComponent(input);
  const plain = [210, 0, ...Buffer.from(encoded, 'ascii')];
  const padding = 16 - (plain.length % 16);
  plain.push(...new Array(padding).fill(padding));
  const plainBytes = Buffer.from(plain);
  const first = Buffer.alloc(16);
  for (let index = 0; index < 16; index += 1) first[index] = plainBytes[index] ^ KEY16[index] ^ 42;
  const firstCipher = encryptBlock(first);
  const cipher = Buffer.alloc(plainBytes.length);
  firstCipher.copy(cipher, 0);
  if (plainBytes.length > 16) encryptBlocks(plainBytes.subarray(16), firstCipher).copy(cipher, 16);
  return customEncode(cipher);
}

export function signRequest(url, dc0 = '', body = null, zse93 = '101_3_3.0') {
  const parsed = new URL(url);
  const pathname = `${parsed.pathname}${parsed.search}`;
  const source = [zse93, pathname, dc0, body].filter((value) => value !== null).join('+');
  const md5 = crypto.createHash('md5').update(source).digest('hex');
  return `2.0_${encryptZseV4(md5)}`;
}
