import { HttpError } from "./errors";

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const MAX_TEXT_CHARS = 80_000;

/** Plain text from an uploaded .txt, .md or .pdf file. */
export async function documentText(file: File): Promise<string> {
	if (file.size > MAX_UPLOAD_BYTES) throw new HttpError(413, "Files up to 20 MB can be imported.");
	const name = file.name.toLowerCase();
	let text: string;
	if (name.endsWith(".pdf") || file.type === "application/pdf") {
		text = await pdfText(new Uint8Array(await file.arrayBuffer()));
	} else if (/\.(txt|md|markdown|text)$/.test(name) || file.type.startsWith("text/")) {
		text = await file.text();
	} else {
		throw new HttpError(415, "Import a .txt, .md or .pdf file. For Word or Google Docs, copy the text and paste it into Capture.");
	}
	text = text.replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
	if (!text) throw new HttpError(422, "No text could be read from that file. A scanned PDF has no text layer; paste the text instead.");
	if (text.length > MAX_TEXT_CHARS) {
		throw new HttpError(413, `That document has ${text.length.toLocaleString()} characters; import up to ${MAX_TEXT_CHARS.toLocaleString()} at a time.`);
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
