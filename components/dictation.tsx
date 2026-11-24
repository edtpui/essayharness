"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject, type TextareaHTMLAttributes } from "react";
import Link from "next/link";
import { appendText, deepgramListenUrl } from "@/lib/text";
import { useDictationSettings } from "./app-context";
import { MicIcon, StopIcon } from "./icons";
import { TextArea, cx } from "./ui";

/* Live dictation: mic → AudioWorklet (linear16) → Deepgram WebSocket, opened
 * directly from the browser with a short-lived token from /api/stt/token, so
 * audio never passes through this server and the real key never reaches the
 * page. Finalised phrases are delivered as they arrive, so a dropped
 * connection loses at most the phrase in progress. */

type Phase = "idle" | "connecting" | "recording" | "stopping";

interface Run {
	id: number;
	language: string;
	ws: WebSocket | null;
	ctx: AudioContext | null;
	stream: MediaStream | null;
	source: MediaStreamAudioSourceNode | null;
	node: AudioWorkletNode | null;
	pending: ArrayBuffer[];
	stopping: boolean;
	closed: boolean;
	reconnects: number;
	safety: ReturnType<typeof setTimeout> | null;
}

// One recording at a time across the whole page.
let activeRun: { id: number; stop: () => void } | null = null;
let runCounter = 0;

async function fetchToken(): Promise<string> {
	const res = await fetch("/api/stt/token", { cache: "no-store" });
	const data = (await res.json().catch(() => ({}))) as { token?: string; error?: string };
	if (!res.ok || !data.token) throw new Error(data.error ?? `Dictation token request failed (${res.status})`);
	return data.token;
}

function micErrorMessage(err: unknown): string {
	const name = (err as { name?: string })?.name;
	if (name === "NotAllowedError") return "Microphone access is blocked. Allow it in the browser's site settings, then try again.";
	if (name === "NotFoundError") return "No microphone was found.";
	if (name === "NotReadableError") return "The microphone is in use by another app.";
	return err instanceof Error ? err.message : String(err);
}

async function openAudioGraph(stream: MediaStream): Promise<{ ctx: AudioContext; source: MediaStreamAudioSourceNode }> {
	// 16 kHz is what Deepgram wants; Firefox can't resample a mic stream, so fall back to the device rate.
	let ctx = new AudioContext({ sampleRate: 16000 });
	try {
		return { ctx, source: ctx.createMediaStreamSource(stream) };
	} catch {
		await ctx.close().catch(() => undefined);
		ctx = new AudioContext();
		return { ctx, source: ctx.createMediaStreamSource(stream) };
	}
}

export function useDictation({ language, onFinal }: { language: string; onFinal: (text: string) => void }) {
	const [phase, setPhase] = useState<Phase>("idle");
	const [interim, setInterim] = useState("");
	const [error, setError] = useState<string | null>(null);
	const levelRef = useRef(0);
	const runRef = useRef<Run | null>(null);
	const onFinalRef = useRef(onFinal);
	useEffect(() => {
		onFinalRef.current = onFinal;
	}, [onFinal]);

	const teardown = useCallback((run: Run) => {
		if (run.closed) return;
		run.closed = true;
		if (run.safety) clearTimeout(run.safety);
		for (const track of run.stream?.getTracks() ?? []) track.stop();
		run.source?.disconnect();
		if (run.node) {
			run.node.port.onmessage = null;
			run.node.disconnect();
		}
		void run.ctx?.close().catch(() => undefined);
		const ws = run.ws;
		if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
			try {
				ws.close();
			} catch {
				// already closing
			}
		}
		if (activeRun?.id === run.id) activeRun = null;
		if (runRef.current === run) {
			runRef.current = null;
			levelRef.current = 0;
			setPhase("idle");
			setInterim("");
		}
	}, []);

	const finish = useCallback(
		(run: Run) => {
			if (run.closed || run.stopping) return;
			run.stopping = true;
			setPhase("stopping");
			// Mic off first so no new audio is queued, then ask Deepgram to flush and close.
			for (const track of run.stream?.getTracks() ?? []) track.stop();
			run.source?.disconnect();
			run.node?.disconnect();
			const ws = run.ws;
			if (ws && ws.readyState === WebSocket.OPEN) {
				try {
					ws.send(JSON.stringify({ type: "CloseStream" }));
				} catch {
					teardown(run);
					return;
				}
			} else if (!ws && !run.pending.length) {
				teardown(run);
				return;
			}
			// Still connecting: onopen flushes the queued audio and sends CloseStream.
			run.safety = setTimeout(() => teardown(run), 8000);
		},
		[teardown],
	);

	const openSocket = useCallback(
		(run: Run, token: string) => {
			const sampleRate = run.ctx?.sampleRate ?? 16000;
			const ws = new WebSocket(deepgramListenUrl(run.language, sampleRate), ["bearer", token]);
			ws.binaryType = "arraybuffer";
			run.ws = ws;
			ws.onopen = () => {
				if (run.closed) return;
				for (const frame of run.pending) ws.send(frame);
				run.pending = [];
				if (run.stopping) ws.send(JSON.stringify({ type: "CloseStream" }));
				else setPhase("recording");
			};
			ws.onmessage = (event) => {
				if (run.closed || typeof event.data !== "string") return;
				let msg: { type?: string; is_final?: boolean; channel?: { alternatives?: { transcript?: string }[] } };
				try {
					msg = JSON.parse(event.data);
				} catch {
					return;
				}
				if (msg.type !== "Results") return;
				const text = msg.channel?.alternatives?.[0]?.transcript ?? "";
				if (msg.is_final) {
					if (text.trim()) onFinalRef.current(text);
					setInterim("");
				} else {
					setInterim(text);
				}
			};
			ws.onclose = (event) => {
				if (run.closed || run.ws !== ws) return;
				if (run.stopping || event.code === 1000) {
					teardown(run);
					return;
				}
				// Unexpected drop: one reconnect with a fresh token; audio meanwhile is queued.
				if (run.reconnects < 1) {
					run.reconnects++;
					run.ws = null;
					fetchToken()
						.then((fresh) => {
							if (!run.closed) openSocket(run, fresh);
						})
						.catch((err) => {
							setError(`Dictation reconnect failed: ${(err as Error).message}`);
							teardown(run);
						});
				} else {
					setError(`Lost the dictation connection (code ${event.code}).`);
					teardown(run);
				}
			};
		},
		[teardown],
	);

	const start = useCallback(async () => {
		if (runRef.current) return;
		activeRun?.stop();
		setError(null);
		if (!navigator.mediaDevices?.getUserMedia) {
			setError("Dictation needs a secure page: open the app at http://localhost or over HTTPS.");
			return;
		}
		const run: Run = {
			id: ++runCounter,
			language,
			ws: null,
			ctx: null,
			stream: null,
			source: null,
			node: null,
			pending: [],
			stopping: false,
			closed: false,
			reconnects: 0,
			safety: null,
		};
		runRef.current = run;
		activeRun = { id: run.id, stop: () => finish(run) };
		setPhase("connecting");

		const tokenPromise = fetchToken();
		tokenPromise.catch(() => undefined);
		try {
			const stream = await navigator.mediaDevices.getUserMedia({
				audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
			});
			if (run.closed) {
				for (const track of stream.getTracks()) track.stop();
				return;
			}
			run.stream = stream;
			const { ctx, source } = await openAudioGraph(stream);
			run.ctx = ctx;
			run.source = source;
			await ctx.audioWorklet.addModule("/worklets/pcm-capture.js");
			if (ctx.state === "suspended") await ctx.resume();
			if (run.closed) return;
			const node = new AudioWorkletNode(ctx, "pcm-capture");
			run.node = node;
			node.port.onmessage = (event: MessageEvent<{ type: string; rms?: number; buffer?: ArrayBuffer }>) => {
				const msg = event.data;
				if (msg.type === "level") {
					levelRef.current = msg.rms ?? 0;
				} else if (msg.type === "audio" && msg.buffer && !run.stopping) {
					const ws = run.ws;
					if (ws && ws.readyState === WebSocket.OPEN) ws.send(msg.buffer);
					else {
						run.pending.push(msg.buffer);
						if (run.pending.length > 600) run.pending.shift(); // ~75 s of queued audio
					}
				}
			};
			source.connect(node);
			node.connect(ctx.destination); // the worklet outputs silence; this keeps it scheduled
		} catch (err) {
			setError(micErrorMessage(err));
			teardown(run);
			return;
		}
		try {
			const token = await tokenPromise;
			if (!run.closed) openSocket(run, token);
		} catch (err) {
			setError((err as Error).message);
			teardown(run);
		}
	}, [finish, language, openSocket, teardown]);

	const stop = useCallback(() => {
		if (runRef.current) finish(runRef.current);
	}, [finish]);

	const toggle = useCallback(() => {
		if (runRef.current) stop();
		else void start();
	}, [start, stop]);

	useEffect(
		() => () => {
			if (runRef.current) teardown(runRef.current);
		},
		[teardown],
	);

	return { phase, interim, error, levelRef, start, stop, toggle, clearError: () => setError(null) };
}

export function MicButton({
	phase,
	levelRef,
	onClick,
	disabled,
	size = "md",
}: {
	phase: Phase;
	levelRef: RefObject<number>;
	onClick: () => void;
	disabled?: boolean;
	size?: "sm" | "md";
}) {
	const ref = useRef<HTMLButtonElement>(null);
	useEffect(() => {
		if (phase !== "recording") {
			ref.current?.style.setProperty("--level", "0");
			return;
		}
		let frame = 0;
		const tick = () => {
			ref.current?.style.setProperty("--level", String(Math.min(1, (levelRef.current ?? 0) * 6)));
			frame = requestAnimationFrame(tick);
		};
		frame = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(frame);
	}, [phase, levelRef]);

	const live = phase === "recording" || phase === "connecting";
	const label = phase === "connecting" ? "Connecting…" : phase === "recording" ? "Stop" : phase === "stopping" ? "Finishing…" : "Dictate";
	return (
		<button
			ref={ref}
			type="button"
			onClick={onClick}
			disabled={disabled || phase === "stopping"}
			aria-pressed={live}
			className={cx("key", size === "sm" && "key--sm", live && "key--live")}
		>
			{live ? <StopIcon /> : <MicIcon />}
			{label}
		</button>
	);
}

type FieldProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange"> & {
	value: string;
	onChange: (value: string) => void;
	/** Called once when dictated text is first added, so callers can record the note's source. */
	onDictated?: () => void;
	micSize?: "sm" | "md";
	footer?: ReactNode;
};

/** A textarea with a dictation button; finalised speech is appended to the text. */
export function DictationField({ value, onChange, onDictated, micSize = "md", footer, className, disabled, ...rest }: FieldProps) {
	const { language, ready, known } = useDictationSettings();
	const valueRef = useRef(value);
	valueRef.current = value;
	const onDictatedRef = useRef(onDictated);
	onDictatedRef.current = onDictated;

	const handleFinal = useCallback(
		(text: string) => {
			const next = appendText(valueRef.current, text);
			valueRef.current = next; // two phrases can land before the parent re-renders
			onChange(next);
			onDictatedRef.current?.();
		},
		[onChange],
	);
	const dictation = useDictation({ language, onFinal: handleFinal });

	return (
		<div className="flex flex-col gap-2">
			<TextArea value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} className={className} {...rest} />
			<div className="flex min-h-9 flex-wrap items-center gap-2">
				<MicButton phase={dictation.phase} levelRef={dictation.levelRef} onClick={dictation.toggle} disabled={disabled || (known && !ready)} size={micSize} />
				{known && !ready && (
					<span className="text-xs text-muted">
						Add a Deepgram key in{" "}
						<Link href="/settings" className="underline">
							Settings
						</Link>{" "}
						to dictate.
					</span>
				)}
				{dictation.interim && <span className="min-w-0 flex-1 truncate text-sm text-muted italic">{dictation.interim}</span>}
				{footer && <div className="ml-auto flex items-center gap-2">{footer}</div>}
			</div>
			{dictation.error && <p className="text-xs text-error">{dictation.error}</p>}
		</div>
	);
}
