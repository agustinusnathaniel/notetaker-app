import { env } from "@notetaker-app/env/server";
import { Effect } from "effect";
import { Hono } from "hono";

const MAX_AUDIO_BYTES = 4 * 1024 * 1024;
const DECIMAL_DIGITS_PATTERN = /^\d+$/;
const EFFECT_INTERRUPTION_MESSAGE = "All fibers interrupted without error";

type AudioBodyResult =
	| { readonly kind: "empty" }
	| { readonly audio: number[]; readonly kind: "ok" }
	| { readonly kind: "too_large" }
	| { readonly kind: "unreadable" };

interface UnsupportedMediaType {
	readonly _tag: "UnsupportedMediaType";
}

interface InvalidContentLength {
	readonly _tag: "InvalidContentLength";
}

interface EmptyAudio {
	readonly _tag: "EmptyAudio";
}

interface AudioTooLarge {
	readonly _tag: "AudioTooLarge";
}

interface InvalidAudioBody {
	readonly _tag: "InvalidAudioBody";
	readonly cause: unknown;
}

interface TranscriptionUnavailable {
	readonly _tag: "TranscriptionUnavailable";
	readonly cause: unknown;
}

type TranscriptionError =
	| UnsupportedMediaType
	| InvalidContentLength
	| EmptyAudio
	| AudioTooLarge
	| InvalidAudioBody
	| TranscriptionUnavailable;

interface HttpError {
	readonly code:
		| "unsupported_media_type"
		| "invalid_content_length"
		| "empty_audio"
		| "audio_too_large"
		| "invalid_audio_body"
		| "transcription_unavailable";
	readonly message: string;
	readonly status: 400 | 413 | 415 | 502;
}

type TranscriptionOutcome =
	| { readonly kind: "success"; readonly text: string }
	| { readonly error: HttpError; readonly kind: "error" };

export type RunWhisper = (
	audio: number[],
	signal: AbortSignal
) => Promise<{ text: string }>;

function unsupportedMediaType(): UnsupportedMediaType {
	return { _tag: "UnsupportedMediaType" };
}

function invalidContentLength(): InvalidContentLength {
	return { _tag: "InvalidContentLength" };
}

function emptyAudio(): EmptyAudio {
	return { _tag: "EmptyAudio" };
}

function audioTooLarge(): AudioTooLarge {
	return { _tag: "AudioTooLarge" };
}

function invalidAudioBody(cause: unknown): InvalidAudioBody {
	return { _tag: "InvalidAudioBody", cause };
}

function transcriptionUnavailable(cause: unknown): TranscriptionUnavailable {
	return { _tag: "TranscriptionUnavailable", cause };
}

async function cancelAudioReader(
	reader: ReadableStreamDefaultReader<Uint8Array>
): Promise<void> {
	try {
		await reader.cancel();
	} catch {
		return undefined;
	}
}

async function readAudioBodyUnsafe(
	body: ReadableStream<Uint8Array>,
	signal: AbortSignal
): Promise<AudioBodyResult> {
	const reader = body.getReader();
	const audio: number[] = [];
	const cancelOnAbort = () => {
		cancelAudioReader(reader).catch(() => undefined);
	};
	signal.addEventListener("abort", cancelOnAbort, { once: true });

	try {
		if (signal.aborted) {
			await cancelAudioReader(reader);
			return { kind: "unreadable" };
		}

		while (!signal.aborted) {
			// biome-ignore lint/performance/noAwaitInLoops: sequential reads enforce the byte cap.
			const { done, value } = await reader.read();
			if (signal.aborted) {
				return { kind: "unreadable" };
			}
			if (done) {
				return audio.length === 0 ? { kind: "empty" } : { audio, kind: "ok" };
			}

			if (!value) {
				continue;
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
	} catch (cause) {
		await cancelAudioReader(reader);
		throw cause;
	} finally {
		signal.removeEventListener("abort", cancelOnAbort);
		reader.releaseLock();
	}
}

function readAudioBody(
	body: ReadableStream<Uint8Array> | null
): Effect.Effect<number[], EmptyAudio | AudioTooLarge | InvalidAudioBody> {
	return Effect.gen(function* () {
		if (!body) {
			return yield* Effect.fail(emptyAudio());
		}

		const result = yield* Effect.tryPromise({
			try: (signal) => readAudioBodyUnsafe(body, signal),
			catch: invalidAudioBody,
		});

		if (result.kind === "empty") {
			return yield* Effect.fail(emptyAudio());
		}
		if (result.kind === "too_large") {
			return yield* Effect.fail(audioTooLarge());
		}
		if (result.kind === "unreadable") {
			return yield* Effect.fail(invalidAudioBody("The stream was cancelled."));
		}

		return result.audio;
	});
}

function validateRequest(
	contentType: string | undefined,
	contentLengthHeader: string | undefined
): Effect.Effect<
	void,
	UnsupportedMediaType | InvalidContentLength | AudioTooLarge
> {
	return Effect.gen(function* () {
		if (
			!contentType?.startsWith("audio/") ||
			contentType.length <= "audio/".length
		) {
			return yield* Effect.fail(unsupportedMediaType());
		}

		if (contentLengthHeader !== undefined) {
			if (!DECIMAL_DIGITS_PATTERN.test(contentLengthHeader)) {
				return yield* Effect.fail(invalidContentLength());
			}

			const contentLength = Number(contentLengthHeader);
			if (!Number.isSafeInteger(contentLength)) {
				return yield* Effect.fail(invalidContentLength());
			}
			if (contentLength > MAX_AUDIO_BYTES) {
				return yield* Effect.fail(audioTooLarge());
			}
		}
	});
}

function toHttpError(error: TranscriptionError): HttpError {
	switch (error._tag) {
		case "UnsupportedMediaType":
			return {
				code: "unsupported_media_type",
				message: "Send an audio file with an audio/* Content-Type.",
				status: 415,
			};
		case "InvalidContentLength":
			return {
				code: "invalid_content_length",
				message: "Content-Length must be a valid byte count.",
				status: 400,
			};
		case "EmptyAudio":
			return {
				code: "empty_audio",
				message: "Send a non-empty audio file.",
				status: 400,
			};
		case "AudioTooLarge":
			return {
				code: "audio_too_large",
				message: "Audio files must be 4 MiB or smaller.",
				status: 413,
			};
		case "InvalidAudioBody":
			return {
				code: "invalid_audio_body",
				message: "The audio body could not be read.",
				status: 400,
			};
		case "TranscriptionUnavailable":
			return {
				code: "transcription_unavailable",
				message: "Transcription is temporarily unavailable.",
				status: 502,
			};
		default:
			return assertNever(error);
	}
}

function assertNever(value: never): never {
	throw new Error(`Unexpected transcription error: ${String(value)}`);
}

function transcribeAudio(
	contentType: string | undefined,
	contentLengthHeader: string | undefined,
	body: ReadableStream<Uint8Array> | null,
	runWhisperFn: RunWhisper
): Effect.Effect<TranscriptionOutcome, never> {
	const program = Effect.gen(function* () {
		yield* validateRequest(contentType, contentLengthHeader);
		const audio = yield* readAudioBody(body);
		const result = yield* Effect.tryPromise({
			try: (signal) => runWhisperFn(audio, signal),
			catch: transcriptionUnavailable,
		});

		return { kind: "success", text: result.text } as const;
	});

	return program.pipe(
		Effect.catchTags({
			UnsupportedMediaType: (error) =>
				Effect.succeed({ kind: "error", error: toHttpError(error) } as const),
			InvalidContentLength: (error) =>
				Effect.succeed({ kind: "error", error: toHttpError(error) } as const),
			EmptyAudio: (error) =>
				Effect.succeed({ kind: "error", error: toHttpError(error) } as const),
			AudioTooLarge: (error) =>
				Effect.succeed({ kind: "error", error: toHttpError(error) } as const),
			InvalidAudioBody: (error) =>
				Effect.succeed({ kind: "error", error: toHttpError(error) } as const),
			TranscriptionUnavailable: (error) =>
				Effect.succeed({ kind: "error", error: toHttpError(error) } as const),
		})
	);
}

const runWhisper: RunWhisper = (audio, signal) =>
	env.AI.run("@cf/openai/whisper", { audio }, { signal }).then((result) => ({
		text: result.text,
	}));

const transcribe = new Hono();

transcribe.post("/transcribe", async (c) => {
	const contentType = c.req
		.header("content-type")
		?.split(";", 1)[0]
		?.trim()
		.toLowerCase();
	let outcome: TranscriptionOutcome;
	try {
		outcome = await Effect.runPromise(
			transcribeAudio(
				contentType,
				c.req.header("content-length"),
				c.req.raw.body,
				runWhisper
			),
			{ signal: c.req.raw.signal }
		);
	} catch (error) {
		if (
			c.req.raw.signal.aborted &&
			error instanceof Error &&
			error.message === EFFECT_INTERRUPTION_MESSAGE
		) {
			return new Response(null, { status: 499 });
		}

		throw error;
	}

	if (outcome.kind === "error") {
		return c.json(
			{ error: { code: outcome.error.code, message: outcome.error.message } },
			outcome.error.status
		);
	}

	return c.json({ text: outcome.text });
});

export default transcribe;
