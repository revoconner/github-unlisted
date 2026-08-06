"use client";

import { useRouter } from "next/navigation";
import * as React from "react";
import { buildHref } from "@/lib/repo-path";

// Recipient-facing branch picker. Rendered only for a share that is not locked to a branch AND whose owner opted in, because enumerating branch names tells a recipient things the repository itself does not.
export function BranchSwitcher({
	owner,
	repo,
	branches,
	current,
	shareId,
}: {
	owner: string;
	repo: string;
	branches: string[];
	current: string;
	shareId: string;
}) {
	const router = useRouter();
	const [pending, setPending] = React.useState(false);

	// A ref that is not in the list (a stale link, or a branch deleted since) would otherwise leave the select showing the wrong branch.
	const options = branches.includes(current)
		? branches
		: [current, ...branches];

	return (
		<label className="branchsw">
			<span className="branchsw__label">Branch</span>
			<select
				className="branchsw__sel"
				aria-label="Branch"
				value={current}
				disabled={pending}
				onChange={(e) => {
					const next = e.target.value;
					if (next === current) return;
					setPending(true);
					// Back to the repo root: the current path usually does not exist on the branch being switched to.
					router.push(buildHref(owner, repo, "tree", next, "", shareId));
				}}
			>
				{options.map((b) => (
					<option key={b} value={b}>
						{b}
					</option>
				))}
			</select>
		</label>
	);
}
