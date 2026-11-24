import type { Entry } from "@/lib/types";
import { createEntry } from "@/server/bank";
import { entries } from "@/server/db";
import { documentText } from "@/server/documents";
import { HttpError, errorMessage } from "@/server/errors";
import { handler, json } from "@/server/http";
import { emptyReview, processUpload } from "@/server/uploads";

const MAX_FILES = 20;

/** multipart/form-data: one or more `file` fields, writingSample ("true"/"false").
 *  Each readable file becomes a note right away; adding it to the bank and
 *  reviewing it continue in the background, so the response is immediate. */
export const POST = handler(async (req: Request) => {
	let form: FormData;
	try {
		form = await req.formData();
	} catch {
		throw new HttpError(400, "Send the documents as a file upload.");
	}
	const files = form.getAll("file").filter((f): f is File => f instanceof File);
	if (!files.length) throw new HttpError(400, "Choose at least one file to upload.");
	if (files.length > MAX_FILES) throw new HttpError(400, `Upload up to ${MAX_FILES} files at a time.`);
	const writingSample = form.get("writingSample") === "true";

	const imported: Entry[] = [];
	const failed: { name: string; error: string }[] = [];
	for (const file of files) {
		try {
			const text = await documentText(file);
			const entry = await createEntry({ text, source: "import", title: file.name.slice(0, 200), writingSample });
			const withReview = await entries.update(entry.id, "Note", (e) => ({ ...e, review: emptyReview() }));
			imported.push(withReview);
			processUpload(entry.id);
		} catch (err) {
			failed.push({ name: file.name, error: errorMessage(err) });
		}
	}
	return json({ imported, failed }, imported.length ? 201 : 422);
});
