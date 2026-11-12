import { adapterForConnection } from "@/lib/forge/connections";
import { createGitHubAdapter } from "@/lib/forge/github";
import { adapterForTarget } from "@/lib/forge/target";
import type { ForgeAdapter } from "@/lib/forge/types";
import {
	type ItemOptions,
	isNewItem,
	type PortfolioItemInput,
} from "@/lib/portfolio";
import { type Portfolio, shareBelongsToOwner } from "@/lib/portfolio-store";
import { type Session, sessionOwnsTarget } from "@/lib/session";
import {
	createShare,
	deleteShare,
	listSharesForOwner,
	resolveShare,
	type ShareSettings,
	type ShareTarget,
	updateShareSettings,
	updateShareTtl,
} from "@/lib/share-store";

// How a portfolio's ordered item list becomes real share links.
//
// A portfolio can list repositories that already have a link (the owner made
// it, so the portfolio only references it) and repositories that do not (the
// portfolio creates the link). The links it creates are "managed": they carry
// the portfolio's id, share its revoke date, and are revoked with it. Links
// the owner made on their own are never modified or deleted from here.
//
// Work is split in two so a bad request changes nothing: validateItems only
// reads, executePlan writes and undoes what it created if a later write fails.

type OwnerRef = Pick<Portfolio, "forge" | "installationId" | "connectionId">;

export interface SyncError {
	status: number;
	error: string;
}

type PlanEntry =
	| {
			kind: "existing";
			shareId: string;
			target: ShareTarget;
			managed: boolean;
			options: ItemOptions;
	  }
	| { kind: "new"; owner: string; repo: string; options: ItemOptions };

export interface Plan {
	entries: PlanEntry[];
	// Present only when the plan creates links; built once for the whole plan.
	adapter?: ForgeAdapter;
}

async function adapterForOwner(owner: OwnerRef): Promise<ForgeAdapter | null> {
	if (owner.connectionId !== undefined) {
		return adapterForConnection(owner.connectionId);
	}
	return createGitHubAdapter(owner.installationId as number);
}

// Reads and checks everything; writes nothing.
export async function validateItems(
	session: Session,
	owner: OwnerRef,
	items: PortfolioItemInput[],
	// Undefined while creating: the portfolio has no id yet, so no existing
	// share can already be managed by it.
	portfolioId: string | undefined,
): Promise<{ plan: Plan } | SyncError> {
	const entries: PlanEntry[] = [];
	const wantsNew = items.filter(isNewItem);

	for (const item of items) {
		if (isNewItem(item)) {
			entries.push({
				kind: "new",
				owner: item.owner,
				repo: item.repo,
				options: item,
			});
			continue;
		}
		const target = await resolveShare(item.shareId);
		if (!target) {
			return {
				status: 400,
				error: "A repository in the list is no longer shared",
			};
		}
		// Same two conditions as always: the session owns it, and it belongs to
		// the portfolio's own account. Without the first, anyone could name a
		// share id they merely know; without the second, one account's page could
		// serve another's repository.
		if (
			!sessionOwnsTarget(session, target) ||
			!shareBelongsToOwner(owner, target)
		) {
			return { status: 403, error: "Forbidden" };
		}
		// A link managed by a DIFFERENT portfolio is deleted when that portfolio
		// goes. Letting this one reference it would leave a page pointing at a
		// link that can vanish under it.
		if (target.portfolioId && target.portfolioId !== portfolioId) {
			return {
				status: 400,
				error: "A repository belongs to another portfolio's revoke schedule",
			};
		}
		entries.push({
			kind: "existing",
			shareId: item.shareId,
			target,
			managed: portfolioId !== undefined && target.portfolioId === portfolioId,
			options: item,
		});
	}

	if (wantsNew.length === 0) return { plan: { entries } };

	const adapter = await adapterForOwner(owner);
	if (!adapter) return { status: 404, error: "Connection not found" };

	// A repository is only addable if it is really in this account's listing,
	// exactly the check /api/share makes before it will mint a link.
	let repos: Awaited<ReturnType<ForgeAdapter["listRepos"]>>;
	try {
		repos = await adapter.listRepos();
	} catch {
		return { status: 502, error: "Could not read repositories" };
	}
	const known = new Set(repos.map((r) => `${r.owner}/${r.name}`));

	// Already shared on this account: adding it from the shared list is the
	// right path, and creating a second link would duplicate access.
	const existing = await listSharesForOwner({
		installationIds:
			owner.installationId === undefined ? [] : [owner.installationId],
		connectionIds: owner.connectionId === undefined ? [] : [owner.connectionId],
	});
	const shared = new Set(
		existing
			.filter((s) => shareBelongsToOwner(owner, s))
			.map((s) => `${s.owner}/${s.repo}`),
	);

	for (const n of wantsNew) {
		const name = `${n.owner}/${n.repo}`;
		if (!known.has(name)) {
			return { status: 403, error: "Repo not in this account" };
		}
		if (shared.has(name)) {
			return {
				status: 400,
				error: `${name} is already shared. Add it from the shared repositories`,
			};
		}
	}
	return { plan: { entries, adapter } };
}

// The options a share may actually hold: a forge without an archive or
// releases API cannot honour those, and a branch switcher only means anything
// without a branch lock (a locked link must never enumerate branches).
function clamp(
	options: ItemOptions,
	adapter: ForgeAdapter,
	locked: boolean,
): Pick<ShareTarget, "showReleases" | "allowDownload" | "showBranches"> {
	return {
		showReleases:
			(options.showReleases === true && adapter.capabilities.releases) ||
			undefined,
		allowDownload:
			(options.allowDownload === true && adapter.capabilities.archive) ||
			undefined,
		showBranches: (options.showBranches === true && !locked) || undefined,
	};
}

// Writes the plan. Returns the final ordered share ids. If any write fails,
// every link this call created is deleted again before the error is rethrown,
// so a failure never leaves orphan links behind.
export async function executePlan(
	plan: Plan,
	owner: OwnerRef,
	portfolioId: string,
	ttlSeconds: number | null,
): Promise<string[]> {
	const created: string[] = [];
	try {
		const ids: string[] = [];
		for (const entry of plan.entries) {
			if (entry.kind === "new") {
				const adapter = plan.adapter as ForgeAdapter;
				const id = await createShare(
					{
						...owner,
						owner: entry.owner,
						repo: entry.repo,
						portfolioId,
						...clamp(entry.options, adapter, false),
					} as ShareTarget,
					// An explicit number or null, never undefined: undefined would fall
					// back to the global default window instead of the portfolio's.
					ttlSeconds,
				);
				created.push(id);
				ids.push(id);
				continue;
			}

			ids.push(entry.shareId);
			// Options are only applied to links this portfolio owns, and only the
			// ones the request actually sent.
			const o = entry.options;
			if (
				entry.managed &&
				(o.showReleases !== undefined ||
					o.allowDownload !== undefined ||
					o.showBranches !== undefined)
			) {
				const adapter = await adapterForTarget(entry.target);
				if (!adapter) continue;
				const patch: Partial<ShareSettings> = {};
				const allowed = clamp(
					{
						showReleases: o.showReleases ?? entry.target.showReleases,
						allowDownload: o.allowDownload ?? entry.target.allowDownload,
						showBranches: o.showBranches ?? entry.target.showBranches,
					},
					adapter,
					Boolean(entry.target.ref),
				);
				if (o.showReleases !== undefined)
					patch.showReleases = allowed.showReleases;
				if (o.allowDownload !== undefined) {
					patch.allowDownload = allowed.allowDownload;
				}
				if (o.showBranches !== undefined) {
					patch.showBranches = allowed.showBranches;
				}
				await updateShareSettings(entry.shareId, patch);
			}
		}
		return ids;
	} catch (err) {
		await Promise.all(created.map((id) => deleteShare(id).catch(() => {})));
		throw err;
	}
}

// Gives every link this portfolio manages the portfolio's new revoke moment.
// Settings are untouched (updateShareTtl only resets the window).
export async function syncManagedTtl(
	portfolioId: string,
	shareIds: string[],
	ttlSeconds: number | null,
	skip: ReadonlySet<string> = new Set(),
): Promise<void> {
	for (const id of shareIds) {
		if (skip.has(id)) continue;
		const share = await resolveShare(id);
		if (share?.portfolioId === portfolioId) {
			await updateShareTtl(id, ttlSeconds);
		}
	}
}

// Revokes the links this portfolio created among `shareIds`. Anything else in
// the list is a link the owner made on their own and is left exactly as it is.
export async function deleteManagedShares(
	session: Session,
	portfolioId: string,
	shareIds: string[],
): Promise<number> {
	let deleted = 0;
	for (const id of shareIds) {
		const share = await resolveShare(id);
		if (
			share?.portfolioId === portfolioId &&
			sessionOwnsTarget(session, share)
		) {
			await deleteShare(id);
			deleted++;
		}
	}
	return deleted;
}
