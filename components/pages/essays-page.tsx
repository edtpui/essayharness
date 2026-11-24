"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, messageOf } from "@/lib/api";
import type { Essay, Limit } from "@/lib/types";
import { formatDate, formatLimit } from "@/lib/text";
import { BriefForm } from "../brief-form";
import { Badge, Button, EmptyState, Notice, PageHeader } from "../ui";

interface EssaySummary {
	id: string;
	title: string;
	scholarship: string;
	limit: Limit | null;
	updatedAt: string;
	planned: boolean;
	openQuestions: number;
	versions: number;
	latestLength: { count: number; unit: "words" | "characters"; over: boolean } | null;
}

export function EssaysPage() {
	const router = useRouter();
	const [list, setList] = useState<EssaySummary[] | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [creating, setCreating] = useState(false);

	const load = useCallback(async () => {
		try {
			const data = await api<{ essays: EssaySummary[] }>("/api/essays");
			setList(data.essays);
			if (data.essays.length === 0) setCreating(true);
			setError(null);
		} catch (err) {
			setError(messageOf(err));
		}
	}, []);

	useEffect(() => {
		void load();
	}, [load]);

	return (
		<>
			<PageHeader
				title="Essays"
				description="One entry per application question. The agent plans from your bank, asks about what's missing, then drafts in your voice."
				actions={
					!creating && (
						<Button variant="primary" onClick={() => setCreating(true)}>
							New essay
						</Button>
					)
				}
			/>
			{error && <Notice className="mb-4">{error}</Notice>}
			{creating && (
				<div className="mb-8 panel p-4">
					<h2 className="mb-3 text-md font-semibold">New essay</h2>
					<BriefForm
						submitLabel="Create essay"
						onSubmit={async (input) => {
							const { essay } = await api<{ essay: Essay }>("/api/essays", { body: input });
							router.push(`/essays/${essay.id}`);
						}}
						onCancel={list && list.length > 0 ? () => setCreating(false) : undefined}
					/>
				</div>
			)}
			{list === null ? (
				<p className="text-sm text-muted">Loading…</p>
			) : list.length === 0 ? (
				!creating && <EmptyState>No essays yet.</EmptyState>
			) : (
				<ul className="divide-y divide-rule panel">
					{list.map((e) => (
						<li key={e.id}>
							<Link href={`/essays/${e.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-paper-2">
								<div className="min-w-0 flex-1">
									<p className="text-sm font-medium">{e.title}</p>
									<p className="text-xs text-muted">
										{[e.scholarship, formatLimit(e.limit), `updated ${formatDate(e.updatedAt)}`].filter(Boolean).join(", ")}
									</p>
								</div>
								<div className="flex items-center gap-2 text-xs">
									{!e.planned && <Badge>Not planned</Badge>}
									{e.openQuestions > 0 && <Badge tone="warn">{e.openQuestions} open question{e.openQuestions === 1 ? "" : "s"}</Badge>}
									{e.latestLength ? (
										<Badge tone={e.latestLength.over ? "danger" : "ok"}>
											v{e.versions}, {e.latestLength.count} {e.latestLength.unit}
										</Badge>
									) : (
										e.planned && <Badge>No draft yet</Badge>
									)}
								</div>
							</Link>
						</li>
					))}
				</ul>
			)}
		</>
	);
}
