// Re-mounts on every navigation (unlike layout.tsx), so the .page-fade
// animation replays each time — a fade-in page transition. Reduced-motion
// users get it near-instant via the global block in globals.css.
export default function Template({ children }: { children: React.ReactNode }) {
	return <div className="page-fade">{children}</div>;
}
