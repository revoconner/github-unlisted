/** Built-in adapter registration. New adapters are registered here once. */
import { createGiteaAdapter } from "./gitea";
import { createGiteeAdapter } from "./gitee";
import { createGitLabAdapter } from "./gitlab";
import { registerForgeAdapter } from "./registry";

registerForgeAdapter("gitlab", createGitLabAdapter);
registerForgeAdapter("gitee", createGiteeAdapter);
registerForgeAdapter("gitea", createGiteaAdapter);
