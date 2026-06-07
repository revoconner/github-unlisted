"use client";

import { type FormEvent, useEffect, useState } from "react";
import { createPortal } from "react-dom";

type SubjectKey = "problem" | "feature" | "other";
type Status = "idle" | "sending" | "sent" | "error";

const SUBJECTS: { value: SubjectKey; label: string }[] = [
	{ value: "problem", label: "Reporting a problem" },
	{ value: "feature", label: "Requesting a feature" },
	{ value: "other", label: "Others" },
];

export function ContactButton() {
	const [open, setOpen] = useState(false);
	const [mounted, setMounted] = useState(false);
	const [status, setStatus] = useState<Status>("idle");
	const [error, setError] = useState<string | null>(null);
	const [subject, setSubject] = useState<SubjectKey>("problem");

	useEffect(() => setMounted(true), []);

	useEffect(() => {
		if (!open) return;
		document.body.dataset.contact = "open";
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") setOpen(false);
		};
		document.addEventListener("keydown", onKey);
		return () => {
			document.removeEventListener("keydown", onKey);
			delete document.body.dataset.contact;
		};
	}, [open]);

	function start() {
		setStatus("idle");
		setError(null);
		setSubject("problem");
		setOpen(true);
	}

	async function onSubmit(e: FormEvent<HTMLFormElement>) {
		e.preventDefault();
		const form = e.currentTarget;
		const data = new FormData(form);
		// Honeypot: a real user never fills this; bail silently if a bot did.
		if (String(data.get("company") ?? "").trim() !== "") return;
		setStatus("sending");
		setError(null);
		try {
			const res = await fetch("/api/contact", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					name: data.get("name"),
					email: data.get("email"),
					subject: data.get("subject"),
					customSubject: data.get("customSubject") ?? "",
					message: data.get("message"),
					company: data.get("company") ?? "",
				}),
			});
			const json = (await res.json().catch(() => ({}))) as {
				ok?: boolean;
				error?: string;
			};
			if (!res.ok || !json.ok) {
				throw new Error(
					json.error ?? "Something went wrong. Please try again.",
				);
			}
			form.reset();
			setSubject("problem");
			setStatus("sent");
		} catch (err) {
			setStatus("error");
			setError(err instanceof Error ? err.message : "Something went wrong.");
		}
	}

	const modal = (
		<>
			<button
				type="button"
				className="contact-backdrop"
				aria-label="Close contact form"
				onClick={() => setOpen(false)}
			/>
			<div
				className="contact-modal"
				role="dialog"
				aria-modal="true"
				aria-labelledby="contact-title"
			>
				<div className="contact-modal__head">
					<h2 id="contact-title" className="contact-modal__title">
						Contact
					</h2>
					<button
						type="button"
						className="contact-modal__close"
						aria-label="Close"
						onClick={() => setOpen(false)}
					>
						<svg
							width="14"
							height="14"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
							strokeLinecap="round"
							aria-hidden="true"
						>
							<path d="M6 6l12 12M18 6L6 18" />
						</svg>
					</button>
				</div>

				{status === "sent" ? (
					<div className="contact-sent">
						<p>
							Thanks, your message has been sent. I'll reply over email when I
							can.
						</p>
						<button
							type="button"
							className="contact-submit"
							onClick={() => setOpen(false)}
						>
							Close
						</button>
					</div>
				) : (
					<form className="contact-form" onSubmit={onSubmit}>
						<label className="contact-field">
							<span className="contact-label">Name</span>
							<input
								className="contact-input"
								name="name"
								type="text"
								required
								maxLength={100}
								autoComplete="name"
							/>
						</label>
						<label className="contact-field">
							<span className="contact-label">Email</span>
							<input
								className="contact-input"
								name="email"
								type="email"
								required
								maxLength={200}
								autoComplete="email"
							/>
						</label>
						<label className="contact-field">
							<span className="contact-label">Subject</span>
							<select
								className="contact-input contact-select"
								name="subject"
								value={subject}
								onChange={(e) => setSubject(e.target.value as SubjectKey)}
							>
								{SUBJECTS.map((s) => (
									<option key={s.value} value={s.value}>
										{s.label}
									</option>
								))}
							</select>
						</label>
						{subject === "other" && (
							<label className="contact-field">
								<span className="contact-label">Specify subject</span>
								<input
									className="contact-input"
									name="customSubject"
									type="text"
									required
									maxLength={100}
								/>
							</label>
						)}
						<label className="contact-field">
							<span className="contact-label">Message</span>
							<textarea
								className="contact-input contact-textarea"
								name="message"
								required
								maxLength={5000}
								rows={5}
							/>
						</label>
						{/* Honeypot — hidden from users, catches bots. */}
						<input
							className="contact-hp"
							name="company"
							type="text"
							tabIndex={-1}
							autoComplete="off"
							aria-hidden="true"
						/>
						{status === "error" && error && (
							<p className="contact-error">{error}</p>
						)}
						<button
							type="submit"
							className="contact-submit"
							disabled={status === "sending"}
						>
							{status === "sending" ? "Sending…" : "Send"}
						</button>
					</form>
				)}
			</div>
		</>
	);

	return (
		<>
			<button type="button" className="site-footer__contact" onClick={start}>
				Contact
			</button>
			{mounted && open && createPortal(modal, document.body)}
		</>
	);
}
