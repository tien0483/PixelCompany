/**
 * Minimal ZIP create/extract using Node stdlib only (fs, path, zlib).
 * Supports stored + deflate entries; enough for PixelOffice source bundles.
 */
import { createWriteStream, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import { deflateRawSync, inflateRawSync } from "node:zlib";
import { finished } from "node:stream/promises";

function crc32(buf) {
	let c = ~0;
	for (let i = 0; i < buf.length; i++) {
		c ^= buf[i];
		for (let k = 0; k < 8; k++) {
			c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
		}
	}
	return ~c >>> 0;
}

function u16(n) {
	const b = Buffer.alloc(2);
	b.writeUInt16LE(n, 0);
	return b;
}

function u32(n) {
	const b = Buffer.alloc(4);
	b.writeUInt32LE(n >>> 0, 0);
	return b;
}

function dosDateTime(date = new Date()) {
	const year = Math.max(1980, date.getFullYear());
	const dosTime =
		(date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
	const dosDate =
		((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
	return { dosTime, dosDate };
}

/**
 * @param {string} zipPath
 * @param {{ archivePath: string, data: Buffer }[]} files
 */
export async function createZip(zipPath, files) {
	mkdirSync(dirname(zipPath), { recursive: true });
	const out = createWriteStream(zipPath);
	const central = [];
	let offset = 0;
	const { dosTime, dosDate } = dosDateTime();

	for (const file of files) {
		const name = file.archivePath.replace(/\\/g, "/").replace(/^\/+/, "");
		const nameBuf = Buffer.from(name, "utf8");
		const raw = file.data;
		const compressed = deflateRawSync(raw);
		const useStore = compressed.length >= raw.length;
		const payload = useStore ? raw : compressed;
		const method = useStore ? 0 : 8;
		const crc = crc32(raw);

		const local = Buffer.concat([
			u32(0x04034b50),
			u16(20),
			u16(0),
			u16(method),
			u16(dosTime),
			u16(dosDate),
			u32(crc),
			u32(payload.length),
			u32(raw.length),
			u16(nameBuf.length),
			u16(0),
			nameBuf,
		]);

		const localOffset = offset;
		out.write(local);
		out.write(payload);
		offset += local.length + payload.length;

		central.push(
			Buffer.concat([
				u32(0x02014b50),
				u16(20),
				u16(20),
				u16(0),
				u16(method),
				u16(dosTime),
				u16(dosDate),
				u32(crc),
				u32(payload.length),
				u32(raw.length),
				u16(nameBuf.length),
				u16(0),
				u16(0),
				u16(0),
				u16(0),
				u32(0),
				u32(localOffset),
				nameBuf,
			]),
		);
	}

	const centralStart = offset;
	for (const c of central) {
		out.write(c);
		offset += c.length;
	}
	const centralSize = offset - centralStart;
	const end = Buffer.concat([
		u32(0x06054b50),
		u16(0),
		u16(0),
		u16(files.length),
		u16(files.length),
		u32(centralSize),
		u32(centralStart),
		u16(0),
	]);
	out.write(end);
	out.end();
	await finished(out);
}

/**
 * @param {string} zipPath
 * @param {string} destDir
 * @returns {string[]} extracted relative paths
 */
export function extractZip(zipPath, destDir) {
	const data = readFileSync(zipPath);
	const extracted = [];
	let i = 0;

	while (i + 4 <= data.length) {
		const sig = data.readUInt32LE(i);
		if (sig === 0x02014b50 || sig === 0x06054b50) {
			break;
		}
		if (sig !== 0x04034b50) {
			throw new Error(`Invalid ZIP local header at offset ${i}`);
		}
		const method = data.readUInt16LE(i + 8);
		const compSize = data.readUInt32LE(i + 18);
		const uncompSize = data.readUInt32LE(i + 22);
		const nameLen = data.readUInt16LE(i + 26);
		const extraLen = data.readUInt16LE(i + 28);
		const nameStart = i + 30;
		const name = data.subarray(nameStart, nameStart + nameLen).toString("utf8");
		const dataStart = nameStart + nameLen + extraLen;
		const comp = data.subarray(dataStart, dataStart + compSize);

		if (name.endsWith("/")) {
			mkdirSync(join(destDir, ...name.split("/")), { recursive: true });
		} else {
			let raw;
			if (method === 0) {
				raw = Buffer.from(comp);
			} else if (method === 8) {
				raw = inflateRawSync(comp);
			} else {
				throw new Error(`Unsupported ZIP method ${method} for ${name}`);
			}
			if (uncompSize && raw.length !== uncompSize) {
				// Some writers omit accurate sizes; accept inflate result.
			}
			const parts = name.split("/").filter(Boolean);
			if (parts.some((p) => p === "..")) {
				throw new Error(`Refusing zip path with .. : ${name}`);
			}
			const outPath = join(destDir, ...parts);
			mkdirSync(dirname(outPath), { recursive: true });
			writeFileSync(outPath, raw);
			extracted.push(parts.join("/"));
		}
		i = dataStart + compSize;
	}
	return extracted;
}

/** Normalize to posix archive path under a zip root folder. */
export function toArchivePath(zipRoot, relativePosix) {
	return posix.join(zipRoot, relativePosix.replace(/\\/g, "/"));
}

export function ensureDir(path) {
	if (!existsSync(path)) {
		mkdirSync(path, { recursive: true });
	}
}
