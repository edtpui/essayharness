"use client";

import { useCallback, useEffect, useState } from "react";

/** A text value mirrored to localStorage, so an unsent dictation survives a
 *  reload or a closed tab. Storage failures only lose that convenience. */
export function useLocalDraft(key: string | null): [string, (value: string) => void] {
	const [value, setValue] = useState("");

	useEffect(() => {
		if (!key) return;
		try {
			setValue(localStorage.getItem(key) ?? "");
		} catch {
			setValue("");
		}
	}, [key]);

	const set = useCallback(
		(next: string) => {
			setValue(next);
			if (!key) return;
			try {
				if (next) localStorage.setItem(key, next);
				else localStorage.removeItem(key);
			} catch {
				// storage unavailable
			}
		},
		[key],
	);

	return [value, set];
}
