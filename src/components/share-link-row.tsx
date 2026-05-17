"use client";

import { useRouter } from "next/navigation";
import * as React from "react";

export function ShareLinkRow({
	id,
	owner,
	repo,
}: {
	id: string;
	owner: string;
	repo: string;
}) {
	const router = useRouter();
	const [copied, setCopied] = React.useState(false);
	const [revoking, setRevoking] = React.useState(false);

	const path = `/${owner}/${repo}?s=${id}`;
	const fullUrl =
		typeof window !== "undefined" ? `${window.location.origin}${path}` : path;

	const copy = async () => {
		await navigator.clipboard.writeText(fullUrl);
		setCopied(true);
		setTimeout(() => setCopied(false), 1500);
	};

	const revoke = async () => {
		if (!confirm(`Revoke this link to ${owner}/${repo}?`)) return;
		setRevoking(true);
		try {
			const res = await fetch(`/api/share?id=${encodeURIComponent(id)}`, {
				method: "DELETE",
			});
			if (!res.ok) throw new Error(String(res.status));
			router.refresh();
		} catch {
			setRevoking(false);
		}
	};

	return (
		<li className="flex items-center justify-between gap-4 px-4 py-3">
			<div className="min-w-0">
				<div className="font-mono text-sm">
					{owner}/{repo}
				</div>
				<div className="truncate font-mono text-xs text-neutral-500">
					{path}
				</div>
			</div>
			<div className="flex shrink-0 items-center gap-2">
				<button
					type="button"
					onClick={copy}
					className="rounded border px-2 py-1 text-xs hover:bg-neutral-100"
				>
					{copied ? "Copied" : "Copy link"}
				</button>
				<button
					type="button"
					onClick={revoke}
					disabled={revoking}
					className="rounded border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50"
				>
					{revoking ? "Revoking…" : "Revoke"}
				</button>
			</div>
		</li>
	);
}
