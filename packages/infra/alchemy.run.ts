import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import { retain } from "alchemy/RemovalPolicy";
import { config } from "dotenv";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";

config({ path: "./.env" });
config({ path: "../../apps/web/.env" });
config({ path: "../../apps/server/.env" });

// Existing private R2 bucket (R2_BUCKET_NAME=fft in apps/server/.env).
// Alchemy-managed (R2_MANAGED_BY_ALCHEMY=true): this declaration adopts the
// existing bucket by name instead of creating a duplicate. Retained on
// stack removal so stored audio survives; R2 has no ownership tags so a
// same-named bucket is silently adopted rather than recreated.
export const audioBucket = Cloudflare.R2.Bucket("fft", {
	name: "fft",
}).pipe(retain());

export const server = Cloudflare.Worker("server", {
	compatibility: {
		flags: ["nodejs_compat", "enable_request_signal"],
	},
	dev: {
		port: 3000,
	},
	env: {
		AI: Cloudflare.Workers.AI(),
		AUDIO_BUCKET: audioBucket,
		CORS_ORIGIN: Config.string("CORS_ORIGIN"),
		DATABASE_URL: Config.redacted("DATABASE_URL"),
		DEEPGRAM_API_KEY: Config.redacted("DEEPGRAM_API_KEY"),
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
