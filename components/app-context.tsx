"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, messageOf } from "@/lib/api";
import type { SettingsView } from "@/lib/types";

interface AppState {
	view: SettingsView | null;
	loadError: string | null;
	refresh: () => Promise<void>;
	setView: (view: SettingsView) => void;
}

const AppContext = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
	const [view, setView] = useState<SettingsView | null>(null);
	const [loadError, setLoadError] = useState<string | null>(null);

	const refresh = useCallback(async () => {
		try {
			setView(await api<SettingsView>("/api/settings"));
			setLoadError(null);
		} catch (err) {
			setLoadError(messageOf(err));
		}
	}, []);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	const value = useMemo(() => ({ view, loadError, refresh, setView }), [view, loadError, refresh]);
	return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppState {
	const ctx = useContext(AppContext);
	if (!ctx) throw new Error("useApp must be used inside AppProvider");
	return ctx;
}

/** What dictation needs to know: the language, and whether a Deepgram key exists. */
export function useDictationSettings(): { language: string; ready: boolean; known: boolean } {
	const { view } = useApp();
	return {
		language: view?.settings.dictationLanguage ?? "en",
		ready: view ? view.credentials.deepgram.source !== "none" : false,
		known: view !== null,
	};
}

export function useModelLabel(): string {
	const { view } = useApp();
	if (!view) return "";
	return view.settings.mainModel.model;
}
