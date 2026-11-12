import { initBotId } from "botid/client/core";

// Bots are kept out of the viewer ([...slug]) by gating the content it needs
// behind /api/view. The BotID challenge script can only tag requests made from
// already-loaded page JS (fetch/soft navigation), never the first cold document
// load of a share URL — so the viewer page is a shell that fetches its content
// from this endpoint, and the endpoint is what actually blocks bots.
//
// The portfolio page (/portfolio) works the same way and is gated by
// /api/portfolio/view.
//
// checkLevel here MUST match the server-side checkBotId() call in
// src/app/api/view/route.ts and src/app/api/portfolio/view/route.ts; a
// mismatch fails verification for everyone.
initBotId({
	protect: [
		{
			path: "/api/view",
			method: "POST",
			advancedOptions: {
				checkLevel: "deepAnalysis",
			},
		},
		{
			path: "/api/portfolio/view",
			method: "POST",
			advancedOptions: {
				checkLevel: "deepAnalysis",
			},
		},
	],
});
