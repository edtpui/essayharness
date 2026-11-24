import { inflateRawSync } from "node:zlib";
import { HttpError } from "./errors";

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const MAX_TEXT_CHARS = 80_000;

export const ACCEPTED_EXTENSIONS = [".txt", ".md", ".markdown", ".pdf", ".docx"];

/** Plain text from an uploaded .txt, .md, .pdf or .docx file. */
export async function documentText(file: File): Promise<string> {
	if (file.size > MAX_UPLOAD_BYTES) throw new HttpError(413, `${file.name}: files up to 20 MB can be imported.`);
	const name = file.name.toLowerCase();
	let text: string;
	if (name.endsWith(".pdf") || file.type === "application/pdf") {
		text = await pdfText(new Uint8Array(await file.arrayBuffer()));
	} else if (name.endsWith(".docx")) {
		text = docxText(Buffer.from(await file.arrayBuffer()));
	} else if (/\.(txt|md|markdown|text)$/.test(name) || file.type.startsWith("text/")) {
		text = await file.text();
	} else if (name.endsWith(".doc")) {
		throw new HttpError(415, `${file.name}: old .doc files can't be read. Save it as .docx or PDF, or paste the text into Capture.`);
	} else {
		throw new HttpError(415, `${file.name}: import a .docx, .pdf, .txt or .md file. For Google Docs, download as .docx.`);
	}
	text = text.replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
	if (!text) throw new HttpError(422, `${file.name}: no text could be read. A scanned PDF has no text layer; paste the text instead.`);
	if (text.length > MAX_TEXT_CHARS) {
		throw new HttpError(413, `${file.name} has ${text.length.toLocaleString()} characters; import up to ${MAX_TEXT_CHARS.toLocaleString()} at a time.`);
	}
	return text;
}

async function pdfText(bytes: Uint8Array): Promise<string> {
	const { extractText, getDocumentProxy } = await import("unpdf");
	try {
		const pdf = await getDocumentProxy(bytes);
		const { text } = await extractText(pdf, { mergePages: true });
		return Array.isArray(text) ? text.join("\n\n") : text;
	} catch (err) {
		throw new HttpError(422, `That PDF couldn't be read: ${(err as Error).message}`);
	}
}

/** Reads one file out of a zip archive (a .docx is a zip). */
export function zipEntry(zip: Buffer, wanted: string): Buffer | null {
	// End of central directory: signature 0x06054b50 within the last 64 KiB + 22 bytes.
	let eocd = -1;
	for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65_557); i--) {
		if (zip.readUInt32LE(i) === 0x06054b50) {
			eocd = i;
			break;
		}
	}
	if (eocd === -1) return null;
	const count = zip.readUInt16LE(eocd + 10);
	let p = zip.readUInt32LE(eocd + 16);
	for (let n = 0; n < count && p + 46 <= zip.length; n++) {
		if (zip.readUInt32LE(p) !== 0x02014b50) return null;
		const method = zip.readUInt16LE(p + 10);
		const compressedSize = zip.readUInt32LE(p + 20);
		const nameLength = zip.readUInt16LE(p + 28);
		const extraLength = zip.readUInt16LE(p + 30);
		const commentLength = zip.readUInt16LE(p + 32);
		const localOffset = zip.readUInt32LE(p + 42);
		const name = zip.toString("utf8", p + 46, p + 46 + nameLength);
		if (name === wanted) {
			if (zip.readUInt32LE(localOffset) !== 0x04034b50) return null;
			const start = localOffset + 30 + zip.readUInt16LE(localOffset + 26) + zip.readUInt16LE(localOffset + 28);
			const data = zip.subarray(start, start + compressedSize);
			if (method === 0) return Buffer.from(data);
			if (method === 8) return inflateRawSync(data);
			return null;
		}
		p += 46 + nameLength + extraLength + commentLength;
	}
	return null;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

export function docxText(bytes: Buffer): string {
	let xml: Buffer | null;
	try {
		xml = zipEntry(bytes, "word/document.xml");
	} catch {
		xml = null;
	}
	if (!xml) throw new HttpError(422, "That .docx couldn't be read. Re-save it from Word or Google Docs, or export a PDF.");
	return xml
		.toString("utf8")
		.replace(/<w:tab\/>/g, "\t")
		.replace(/<w:br[^>]*\/>/g, "\n")
		.replace(/<\/w:p>/g, "\n")
		.replace(/<[^>]+>/g, "")
		.replace(/&(amp|lt|gt|quot|apos);/g, (_, e: string) => ENTITIES[e] ?? "")
		.replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
		.replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)));
}
