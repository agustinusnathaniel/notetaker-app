import { env } from "@notetaker-app/env/server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";

import health from "./routes/health";
import meetings from "./routes/meetings";

const app = new Hono();

app.use(logger());
app.use(
	"/*",
	cors({
		allowMethods: ["GET", "POST", "PUT", "OPTIONS"],
		origin: env.CORS_ORIGIN,
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
