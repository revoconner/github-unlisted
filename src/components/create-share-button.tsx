"use client";

import * as React from "react";

export function CreateShareButton({
	installationId,
	owner,
	repo,
}: {
	installationId: number;
	owner: string;
	repo: string;
}) {
	const [state, setState] = React.useState<"idle" | "creating" | "error">(
		"idle",
	);
	const [link, setLink] = React.useState<string | null>(null);
	const [copied, setCopied] = React.useState(false);

	const create = async () => {
		setState("creating");
		setLink(null);
		try {
			const res = await fetch("/api/share", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ installationId, owner, repo }),
			});
			if (!res.ok) throw new Error(String(res.status));
			const data = (await res.json()) as { url: string };
			setLink(data.url);
			setState("idle");
		} catch {
			setState("error");
		}
	};

	const copy = async () => {
		if (!link) return;
		await navigator.clipboard.writeText(link);
		setCopied(true);
		setTimeout(() => setCopied(false), 1500);
	};

	if (link) {
		return (
			<span className="flex items-center gap-2">
				<input
					readOnly
					value={link}
					className="w-64 rounded border bg-neutral-50 px-2 py-1 font-mono text-xs"
				/>
				<button
					type="button"
					onClick={copy}
					className="rounded border px-2 py-1 text-xs hover:bg-neutral-100"
				>
					{copied ? "Copied" : "Copy"}
				</button>
			</span>
		);
	}

	return (
		<button
			type="button"
			onClick={create}
			disabled={state === "creating"}
			className="rounded bg-neutral-900 px-3 py-1 text-xs font-medium text-white hover:bg-neutral-700 disabled:opacity-50"
		>
			{state === "creating"
				? "Creating…"
				: state === "error"
					? "Retry"
					: "Create link"}
		</button>
	);
}
