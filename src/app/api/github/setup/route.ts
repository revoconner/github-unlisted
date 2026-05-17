import { NextResponse } from "next/server";

// GitHub redirects here after install / "redirect on update" (Setup URL).
// We don't get an OAuth code on this path, so kick off the sign-in flow to
// verify who the user is and which installations they control, then /app.
export async function GET(request: Request) {
	const origin = new URL(request.url).origin;
	return NextResponse.redirect(`${origin}/api/github/login`);
}
