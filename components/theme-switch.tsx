"use client";

import { useEffect, useState } from "react";

type Mode = "system" | "light" | "dark";
const KEY = "essayharness-theme";
const NEXT: Record<Mode, Mode> = { system: "light", light: "dark", dark: "system" };
const LABEL: Record<Mode, string> = { system: "System", light: "Light", dark: "Dark" };

/** Runs in <head> before paint so a saved choice never flashes the other theme. */
export const THEME_SCRIPT = `try{var m=localStorage.getItem("${KEY}");if(m==="light"||m==="dark")document.documentElement.dataset.theme=m}catch(e){}`;

function apply(mode: Mode) {
	if (mode === "system") delete document.documentElement.dataset.theme;
	else document.documentElement.dataset.theme = mode;
	try {
		if (mode === "system") localStorage.removeItem(KEY);
		else localStorage.setItem(KEY, mode);
	} catch {
		// storage unavailable: the choice lasts for this page only
	}
}

/** Cycles System → Light → Dark. */
export function ThemeSwitch() {
	const [mode, setMode] = useState<Mode>("system");

	useEffect(() => {
		const current = document.documentElement.dataset.theme;
		setMode(current === "light" || current === "dark" ? current : "system");
	}, []);

	return (
		<button
			type="button"
			className="key key--quiet key--sm shrink-0"
			onClick={() => {
				const next = NEXT[mode];
				apply(next);
				setMode(next);
			}}
			aria-label={`Theme: ${LABEL[mode]}. Switch to ${LABEL[NEXT[mode]]}.`}
			title="Switch theme"
		>
			<svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
				<circle cx="12" cy="12" r="9" />
				<path d="M12 3a9 9 0 0 0 0 18z" fill="currentColor" stroke="none" />
			</svg>
			{LABEL[mode]}
		</button>
	);
}
