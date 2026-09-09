import { Stack } from "alchemy";
import type { InferEnv } from "alchemy/Cloudflare";
import {
	Worker as CloudflareWorker,
	providers,
	R2,
	state,
	Website,
	Workers,
} from "alchemy/Cloudflare";
import { retain } from "alchemy/RemovalPolicy";
import { config } from "dotenv";
import {
	redacted as configRedacted,
	string as configString,
	withDefault as configWithDefault,
} from "effect/Config";
import { gen } from "effect/Effect";
import { make as makeRedacted } from "effect/Redacted";

config({ path: "./.env" });
config({ path: "../../apps/web/.env" });
config({ path: "../../apps/server/.env" });

// Existing private R2 bucket (R2_BUCKET_NAME=fft in apps/server/.env).
// Alchemy-managed (R2_MANAGED_BY_ALCHEMY=true): this declaration adopts the
// existing bucket by name instead of creating a duplicate. Retained on
// stack removal so stored audio survives; R2 has no ownership tags so a
// same-named bucket is silently adopted rather than recreated.
export const audioBucket = R2.Bucket("fft", {
	name: "fft",
}).pipe(retain());

export const server = CloudflareWorker("server", {
	compatibility: {
		flags: ["nodejs_compat", "enable_request_signal"],
	},
	dev: {
		port: 3000,
	},
	env: {
		AI: Workers.AI(),
		AUDIO_BUCKET: audioBucket,
		CORS_EXTRA_ORIGINS: configWithDefault(
			configString("CORS_EXTRA_ORIGINS"),
			""
		),
		CORS_ORIGIN: configString("CORS_ORIGIN"),
		DATABASE_URL: configRedacted("DATABASE_URL"),
		DEEPGRAM_API_KEY: configRedacted("DEEPGRAM_API_KEY"),
		GROQ_API_KEY: configWithDefault(
			configRedacted("GROQ_API_KEY"),
			makeRedacted("")
		),
	},
	main: "../../apps/server/src/index.ts",
});

export type ServerEnv = InferEnv<typeof server>;

export default Stack(
	"notetaker-app",
	{
		providers: providers(),
		state: state(),
	},
	gen(function* () {
		const serverWorker = yield* server;
		const webWorker = yield* Website.Vite("web", {
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
