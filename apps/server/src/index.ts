import { devToolsMiddleware } from "@ai-sdk/devtools";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { env } from "@notetaker-app/env/server";
import {
	convertToModelMessages,
	createUIMessageStreamResponse,
	streamText,
	toUIMessageStream,
	wrapLanguageModel,
} from "ai";
import type { Context } from "hono";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";

const MAX_AUDIO_BYTES = 4 * 1024 * 1024;

type AudioBodyResult =
	| { kind: "empty" }
	| { audio: number[]; kind: "ok" }
	| { kind: "too_large" }
	| { kind: "unreadable" };

const app = new Hono();

function errorResponse(
	c: Context,
	status: 400 | 413 | 415 | 502,
	code: string,
	message: string
) {
	return c.json({ error: { code, message } }, status);
}

async function cancelAudioReader(
	reader: ReadableStreamDefaultReader<Uint8Array>
): Promise<void> {
	await reader.cancel().catch(() => undefined);
}

async function readAudioBody(
	body: ReadableStream<Uint8Array> | null
): Promise<AudioBodyResult> {
	if (!body) {
		return { kind: "empty" };
	}

	const reader = body.getReader();
	const audio: number[] = [];

	try {
		let done = false;
		while (!done) {
			// biome-ignore lint/performance/noAwaitInLoops: sequential reads enforce the byte cap.
			const { done: chunkDone, value } = await reader.read();
			done = chunkDone;
			if (chunkDone) {
				return audio.length === 0 ? { kind: "empty" } : { audio, kind: "ok" };
			}

			const remainingBytes = MAX_AUDIO_BYTES + 1 - audio.length;
			if (value.byteLength >= remainingBytes) {
				for (const byte of value.subarray(0, remainingBytes)) {
					audio.push(byte);
				}
				await cancelAudioReader(reader);
				return { kind: "too_large" };
			}

			for (const byte of value) {
				audio.push(byte);
			}
		}

		return { kind: "unreadable" };
	} catch {
		await cancelAudioReader(reader);
		return { kind: "unreadable" };
	} finally {
		reader.releaseLock();
	}
}

app.use(logger());
app.use(
	"/*",
	cors({
		allowMethods: ["GET", "POST", "OPTIONS"],
		origin: env.CORS_ORIGIN,
	})
);

app.post("/transcribe", async (c) => {
	const contentType = c.req
		.header("content-type")
		?.split(";", 1)[0]
		?.trim()
		.toLowerCase();

	if (
		!contentType?.startsWith("audio/") ||
		contentType.length <= "audio/".length
	) {
		return errorResponse(
			c,
			415,
			"unsupported_media_type",
			"Send an audio file with an audio/* Content-Type."
		);
	}

	const contentLengthHeader = c.req.header("content-length");
	if (contentLengthHeader !== undefined) {
		const contentLength = Number(contentLengthHeader);
		if (!Number.isSafeInteger(contentLength) || contentLength < 0) {
			return errorResponse(
				c,
				400,
				"invalid_content_length",
				"Content-Length must be a valid byte count."
			);
		}
		if (contentLength > MAX_AUDIO_BYTES) {
			return errorResponse(
				c,
				413,
				"audio_too_large",
				"Audio files must be 4 MiB or smaller."
			);
		}
	}

	const audioBody = await readAudioBody(c.req.raw.body);
	if (audioBody.kind === "empty") {
		return errorResponse(c, 400, "empty_audio", "Send a non-empty audio file.");
	}
	if (audioBody.kind === "too_large") {
		return errorResponse(
			c,
			413,
			"audio_too_large",
			"Audio files must be 4 MiB or smaller."
		);
	}
	if (audioBody.kind === "unreadable") {
		return errorResponse(
			c,
			400,
			"invalid_audio_body",
			"The audio body could not be read."
		);
	}

	try {
		const result = await env.AI.run("@cf/openai/whisper", {
			audio: audioBody.audio,
		});

		return c.json({ text: result.text });
	} catch {
		return errorResponse(
			c,
			502,
			"transcription_unavailable",
			"Transcription is temporarily unavailable."
		);
	}
});

app.post("/ai", async (c) => {
	const body = await c.req.json();
	const uiMessages = body.messages || [];
	const google = createGoogleGenerativeAI({
		apiKey: env.GOOGLE_GENERATIVE_AI_API_KEY,
	});
	const model = wrapLanguageModel({
		middleware: devToolsMiddleware(),
		model: google("gemini-2.5-flash"),
	});
	const result = streamText({
		messages: await convertToModelMessages(uiMessages),
		model,
	});

	return createUIMessageStreamResponse({
		stream: toUIMessageStream({ stream: result.stream }),
	});
});

app.get("/", (c) => c.text("OK"));

export default app;
