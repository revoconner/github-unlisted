import { initBotId } from "botid/client/core";

// Bots are kept out of the viewer ([...slug]) by gating the content it needs
// behind /api/view. The BotID challenge script can only tag requests made from
// already-loaded page JS (fetch/soft navigation), never the first cold document
// load of a share URL — so the viewer page is a shell that fetches its content
// from this endpoint, and the endpoint is what actually blocks bots.
//
// checkLevel here MUST match the server-side checkBotId() call in
// src/app/api/view/route.ts; a mismatch fails verification for everyone.
initBotId({
	protect: [
		{
			path: "/api/view",
			method: "POST",
			advancedOptions: {
				checkLevel: "deepAnalysis",
			},
		},
	],
});
