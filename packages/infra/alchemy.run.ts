import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import { config } from "dotenv";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";

config({ path: "./.env" });
config({ path: "../../apps/web/.env" });
config({ path: "../../apps/server/.env" });

export const server = Cloudflare.Worker("server", {
	compatibility: {
		flags: ["nodejs_compat"],
	},
	dev: {
		port: 3000,
	},
	env: {
		AI: Cloudflare.Workers.AI(),
		CORS_ORIGIN: Config.string("CORS_ORIGIN"),
		DATABASE_URL: Config.redacted("DATABASE_URL"),
		GOOGLE_GENERATIVE_AI_API_KEY: Config.redacted(
			"GOOGLE_GENERATIVE_AI_API_KEY"
		),
	},
	main: "../../apps/server/src/index.ts",
});

export type ServerEnv = Cloudflare.InferEnv<typeof server>;

export default Alchemy.Stack(
	"notetaker-app",
	{
		providers: Cloudflare.providers(),
		state: Cloudflare.state(),
	},
	Effect.gen(function* () {
		const serverWorker = yield* server;
		const webWorker = yield* Cloudflare.Website.Vite("web", {
			assets: {
				htmlHandling: "auto-trailing-slash",
				notFoundHandling: "single-page-application",
			},
			dev: {
				port: 3001,
			},
			env: {
				VITE_SERVER_URL: serverWorker.url.as<string>(),
			},
			rootDir: "../../apps/web",
		});

		return {
			server: serverWorker.url,
			web: webWorker.url,
		};
	})
);
