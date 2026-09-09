import { env } from "@notetaker-app/env/server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";

import health from "./routes/health";
import meetings from "./routes/meetings";

const extraOrigins =
	typeof env.CORS_EXTRA_ORIGINS === "string" &&
	env.CORS_EXTRA_ORIGINS.length > 0
		? env.CORS_EXTRA_ORIGINS.split(",")
				.map((origin) => origin.trim())
				.filter((origin) => origin.length > 0)
		: [];
const allowedOrigins = [...new Set([env.CORS_ORIGIN, ...extraOrigins])];

const app = new Hono();

app.use(logger());
app.use(
	"/*",
	cors({
		allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
		origin: allowedOrigins,
	})
);

app.onError((_error, c) =>
	c.json(
		{
			error: {
				code: "internal_error",
				message: "An unexpected error occurred.",
			},
		},
		500
	)
);

app.route("/", health);
app.route("/", meetings);

export default app;
