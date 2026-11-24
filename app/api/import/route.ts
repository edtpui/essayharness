import { createEntry, extractEntry } from "@/server/bank";
import { documentText } from "@/server/documents";
import { HttpError } from "@/server/errors";
import { handler, json } from "@/server/http";

/** multipart/form-data: file, writingSample ("true"/"false"). */
export const POST = handler(async (req: Request) => {
	let form: FormData;
	try {
		form = await req.formData();
	} catch {
		throw new HttpError(400, "Send the document as a file upload.");
	}
	const file = form.get("file");
	if (!(file instanceof File)) throw new HttpError(400, "Choose a file to import.");
	const text = await documentText(file);
	const entry = await createEntry({
		text,
		source: "import",
		title: file.name.slice(0, 200),
		writingSample: form.get("writingSample") === "true",
	});
	return json(await extractEntry(entry.id), 201);
});
