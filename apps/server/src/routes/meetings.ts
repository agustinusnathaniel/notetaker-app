import { createDb } from "@notetaker-app/db";
import {
	type ActionItem,
	type Meeting,
	meetings,
	type TranscriptSegment,
} from "@notetaker-app/db/schema/index";
import { env } from "@notetaker-app/env/server";
import { desc, eq } from "drizzle-orm";
import { Effect } from "effect";
import { Hono } from "hono";
import { z } from "zod";

const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const UUID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DECIMAL_DIGITS_PATTERN = /^\d+$/;
const AUDIO_PREFIX = "audio/";
const EXTENSION_PATTERN = /^[a-z0-9]+$/;
const FILENAME_EXTENSION_PATTERN = /\.[^.]+$/;
const MAX_EXTENSION_LENGTH = 16;
const EFFECT_INTERRUPTION_MESSAGE = "All fibers interrupted without error";

type Db = ReturnType<typeof createDb>;

interface InvalidMeetingId {
	readonly _tag: "InvalidMeetingId";
}

interface MeetingNotFound {
	readonly _tag: "MeetingNotFound";
}

interface InvalidBody {
	readonly _tag: "InvalidBody";
	readonly message: string;
}

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

interface AudioNotFound {
	readonly _tag: "AudioNotFound";
}

interface StorageFailure {
	readonly _tag: "StorageFailure";
	readonly cause: unknown;
	readonly meetingId: string | null;
}

type MeetingsError =
	| AudioNotFound
	| AudioTooLarge
	| EmptyAudio
	| InvalidAudioBody
	| InvalidBody
	| InvalidContentLength
	| InvalidMeetingId
	| MeetingNotFound
	| StorageFailure
	| UnsupportedMediaType;

interface HttpError {
	readonly code:
		| "invalid_meeting_id"
		| "meeting_not_found"
		| "invalid_body"
		| "unsupported_media_type"
		| "invalid_content_length"
		| "empty_audio"
		| "audio_too_large"
		| "invalid_audio_body"
		| "audio_not_found"
		| "internal_error";
	readonly message: string;
	readonly status: 400 | 404 | 413 | 415 | 500;
}

interface SuccessOutcome<TData> {
	readonly data: TData;
	readonly kind: "success";
}

interface ErrorOutcome {
	readonly error: HttpError;
	readonly kind: "error";
}

type Outcome<TData> = SuccessOutcome<TData> | ErrorOutcome;

interface PublicMeeting {
	readonly actionItems: ActionItem[];
	readonly audioAvailable: boolean;
	readonly audioBytes: number | null;
	readonly audioMimeType: string | null;
	readonly createdAt: string;
	readonly description: string | null;
	readonly durationSeconds: number;
	readonly failedStage: "upload" | "transcription" | "summary" | null;
	readonly id: string;
	readonly occurredAt: string;
	readonly source: "upload" | "recording" | "demo";
	readonly status:
		| "draft"
		| "uploading"
		| "transcribing"
		| "summarizing"
		| "completed"
		| "failed";
	readonly summary: string | null;
	readonly takeaways: string[];
	readonly title: string;
	readonly transcript: string | null;
	readonly transcriptSegments: TranscriptSegment[];
	readonly updatedAt: string;
}

interface ResolvedAudio {
	readonly body: ReadableStream;
	readonly mimeType: string;
	readonly size: number;
}

type AudioBodyResult =
	| { readonly kind: "empty" }
	| { readonly audio: number[]; readonly kind: "ok" }
	| { readonly kind: "too_large" }
	| { readonly kind: "unreadable" };

const CreateMeetingSchema = z.object({
	description: z.string().trim().max(200).nullable().optional(),
	durationSeconds: z.number().int().min(0).optional(),
	filename: z.string().max(255).optional(),
	occurredAt: z.string().optional(),
	source: z.enum(["upload", "recording", "demo"]).optional(),
	title: z.string().trim().max(100).optional(),
});

type CreateMeetingInput = z.infer<typeof CreateMeetingSchema>;

const MIME_TO_EXTENSION: Record<string, string> = {
	"audio/3gpp": "3gp",
	"audio/3gpp2": "3g2",
	"audio/aac": "aac",
	"audio/flac": "flac",
	"audio/midi": "mid",
	"audio/mp4": "m4a",
	"audio/mpeg": "mp3",
	"audio/ogg": "ogg",
	"audio/opus": "opus",
	"audio/wav": "wav",
	"audio/wave": "wav",
	"audio/webm": "webm",
	"audio/x-aac": "aac",
	"audio/x-flac": "flac",
	"audio/x-m4a": "m4a",
	"audio/x-midi": "mid",
	"audio/x-wav": "wav",
};

function invalidMeetingId(): InvalidMeetingId {
	return { _tag: "InvalidMeetingId" };
}

function meetingNotFound(): MeetingNotFound {
	return { _tag: "MeetingNotFound" };
}

function invalidBody(message: string): InvalidBody {
	return { _tag: "InvalidBody", message };
}

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

function audioNotFound(): AudioNotFound {
	return { _tag: "AudioNotFound" };
}

function storageFailure(
	cause: unknown,
	meetingId: string | null = null
): StorageFailure {
	return { _tag: "StorageFailure", cause, meetingId };
}

function toPublicMeeting(row: Meeting): PublicMeeting {
	return {
		actionItems: row.actionItems,
		audioAvailable: row.audioKey !== null,
		audioBytes: row.audioBytes,
		audioMimeType: row.audioMimeType,
		createdAt: row.createdAt.toISOString(),
		description: row.description,
		durationSeconds: row.durationSeconds,
		failedStage: row.failedStage,
		id: row.id,
		occurredAt: row.occurredAt.toISOString(),
		source: row.source,
		status: row.status,
		summary: row.summary,
		takeaways: row.takeaways,
		title: row.title,
		transcript: row.transcript,
		transcriptSegments: row.transcriptSegments,
		updatedAt: row.updatedAt.toISOString(),
	};
}

function extForMimeType(mimeType: string): string {
	const mapped = MIME_TO_EXTENSION[mimeType];
	if (mapped) {
		return mapped;
	}

	const subtype = mimeType.slice(AUDIO_PREFIX.length).trim().toLowerCase();
	if (
		subtype.length > 0 &&
		subtype.length <= MAX_EXTENSION_LENGTH &&
		EXTENSION_PATTERN.test(subtype)
	) {
		return subtype;
	}

	return "bin";
}

function deriveTitle(input: CreateMeetingInput, occurredAt: Date): string {
	const title = input.title?.trim();
	if (title) {
		return title;
	}

	const filename = input.filename?.trim();
	if (filename) {
		const basename =
			filename
				.split("/")
				.pop()
				?.split("\\")
				.pop()
				?.replace(FILENAME_EXTENSION_PATTERN, "")
				.trim() ?? "";
		if (basename) {
			return basename.slice(0, 100);
		}
	}

	return `Meeting on ${occurredAt.toISOString().slice(0, 10)}`;
}

function deriveDescription(input: CreateMeetingInput): string | null {
	const description = input.description?.trim();
	return description ? description : null;
}

function parseMeetingId(
	value: string
): Effect.Effect<string, InvalidMeetingId> {
	return UUID_PATTERN.test(value)
		? Effect.succeed(value)
		: Effect.fail(invalidMeetingId());
}

function parseOccurredAt(
	value: string | undefined
): Effect.Effect<Date, InvalidBody> {
	if (value === undefined) {
		return Effect.succeed(new Date());
	}

	const time = Date.parse(value);
	if (Number.isNaN(time)) {
		return Effect.fail(
			invalidBody("occurredAt must be a valid date-time string.")
		);
	}

	return Effect.succeed(new Date(time));
}

function makeDb(): Effect.Effect<Db, StorageFailure> {
	return Effect.try({
		try: () => createDb(),
		catch: (cause) => storageFailure(cause),
	});
}

function findMeetingById(
	db: Db,
	id: string
): Effect.Effect<Meeting, StorageFailure | MeetingNotFound> {
	return Effect.gen(function* () {
		const rows = yield* Effect.tryPromise({
			try: () => db.select().from(meetings).where(eq(meetings.id, id)).limit(1),
			catch: (cause): StorageFailure => storageFailure(cause, id),
		});

		const [row] = rows;
		if (!row) {
			return yield* Effect.fail(meetingNotFound());
		}

		return row;
	});
}

function markUploadFailed(meetingId: string): Effect.Effect<void, never> {
	return Effect.tryPromise({
		try: async (): Promise<void> => {
			const db = createDb();
			await db
				.update(meetings)
				.set({
					failedStage: "upload",
					status: "failed",
					updatedAt: new Date(),
				})
				.where(eq(meetings.id, meetingId));
		},
		catch: (): unknown => null,
	}).pipe(Effect.ignore);
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

function validateAudioRequest(
	contentType: string | undefined,
	contentLengthHeader: string | undefined
): Effect.Effect<
	void,
	UnsupportedMediaType | InvalidContentLength | AudioTooLarge
> {
	return Effect.gen(function* () {
		if (
			!contentType?.startsWith(AUDIO_PREFIX) ||
			contentType === AUDIO_PREFIX
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

function toHttpError(error: MeetingsError): HttpError {
	switch (error._tag) {
		case "InvalidMeetingId":
			return {
				code: "invalid_meeting_id",
				message: "The meeting ID is not a valid UUID.",
				status: 400,
			};
		case "MeetingNotFound":
			return {
				code: "meeting_not_found",
				message: "The requested meeting was not found.",
				status: 404,
			};
		case "InvalidBody":
			return {
				code: "invalid_body",
				message: error.message,
				status: 400,
			};
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
				message: "Audio files must be 25 MiB or smaller.",
				status: 413,
			};
		case "InvalidAudioBody":
			return {
				code: "invalid_audio_body",
				message: "The audio body could not be read.",
				status: 400,
			};
		case "AudioNotFound":
			return {
				code: "audio_not_found",
				message: "No audio is stored for this meeting.",
				status: 404,
			};
		case "StorageFailure":
			return {
				code: "internal_error",
				message: "An unexpected error occurred.",
				status: 500,
			};
		default:
			return assertNever(error);
	}
}

function assertNever(value: never): never {
	throw new Error(`Unexpected meetings error: ${String(value)}`);
}

function listMeetings(): Effect.Effect<Outcome<PublicMeeting[]>, never> {
	const program = Effect.gen(function* () {
		const db = yield* makeDb();
		const rows = yield* Effect.tryPromise({
			try: () => db.select().from(meetings).orderBy(desc(meetings.createdAt)),
			catch: (cause): StorageFailure => storageFailure(cause),
		});

		return { data: rows.map(toPublicMeeting), kind: "success" } as const;
	});

	return program.pipe(
		Effect.catchTags({
			StorageFailure: (error) =>
				Effect.succeed({ error: toHttpError(error), kind: "error" } as const),
		})
	);
}

function createMeeting(
	raw: unknown
): Effect.Effect<Outcome<PublicMeeting>, never> {
	const program = Effect.gen(function* () {
		const parsed = CreateMeetingSchema.safeParse(raw);
		if (!parsed.success) {
			return yield* Effect.fail(invalidBody("The request body is invalid."));
		}

		const input = parsed.data;
		const occurredAt = yield* parseOccurredAt(input.occurredAt);
		const db = yield* makeDb();
		const rows = yield* Effect.tryPromise({
			try: () =>
				db
					.insert(meetings)
					.values({
						description: deriveDescription(input),
						durationSeconds: input.durationSeconds ?? 0,
						occurredAt,
						source: input.source ?? "upload",
						status: "draft",
						title: deriveTitle(input, occurredAt),
					})
					.returning(),
			catch: (cause): StorageFailure => storageFailure(cause),
		});

		const [inserted] = rows;
		if (!inserted) {
			return yield* Effect.fail(storageFailure("Insert returned no rows."));
		}

		return { data: toPublicMeeting(inserted), kind: "success" } as const;
	});

	return program.pipe(
		Effect.catchTags({
			InvalidBody: (error) =>
				Effect.succeed({ error: toHttpError(error), kind: "error" } as const),
			StorageFailure: (error) =>
				Effect.succeed({ error: toHttpError(error), kind: "error" } as const),
		})
	);
}

function getMeeting(
	meetingIdParam: string
): Effect.Effect<Outcome<PublicMeeting>, never> {
	const program = Effect.gen(function* () {
		const meetingId = yield* parseMeetingId(meetingIdParam);
		const db = yield* makeDb();
		const row = yield* findMeetingById(db, meetingId);

		return { data: toPublicMeeting(row), kind: "success" } as const;
	});

	return program.pipe(
		Effect.catchTags({
			InvalidMeetingId: (error) =>
				Effect.succeed({ error: toHttpError(error), kind: "error" } as const),
			MeetingNotFound: (error) =>
				Effect.succeed({ error: toHttpError(error), kind: "error" } as const),
			StorageFailure: (error) =>
				Effect.succeed({ error: toHttpError(error), kind: "error" } as const),
		})
	);
}

function putMeetingAudio(
	meetingIdParam: string,
	contentType: string | undefined,
	contentLengthHeader: string | undefined,
	body: ReadableStream<Uint8Array> | null
): Effect.Effect<Outcome<PublicMeeting>, never> {
	const program = Effect.gen(function* () {
		const meetingId = yield* parseMeetingId(meetingIdParam);
		const db = yield* makeDb();
		yield* findMeetingById(db, meetingId);
		yield* validateAudioRequest(contentType, contentLengthHeader);
		if (contentType === undefined) {
			return yield* Effect.fail(unsupportedMediaType());
		}
		const audio = yield* readAudioBody(body);
		const audioKey = `meetings/${meetingId}/audio.${extForMimeType(contentType)}`;
		yield* Effect.tryPromise({
			try: () =>
				env.AUDIO_BUCKET.put(audioKey, new Uint8Array(audio), {
					httpMetadata: { contentType },
				}),
			catch: (cause): StorageFailure => storageFailure(cause, meetingId),
		});
		const rows = yield* Effect.tryPromise({
			try: () =>
				db
					.update(meetings)
					.set({
						audioBytes: audio.length,
						audioKey,
						audioMimeType: contentType,
						failedStage: null,
						status: "uploading",
						updatedAt: new Date(),
					})
					.where(eq(meetings.id, meetingId))
					.returning(),
			catch: (cause): StorageFailure => storageFailure(cause, meetingId),
		});

		const [updated] = rows;
		if (!updated) {
			return yield* Effect.fail(meetingNotFound());
		}

		return { data: toPublicMeeting(updated), kind: "success" } as const;
	});

	return program.pipe(
		Effect.catchTags({
			InvalidMeetingId: (error) =>
				Effect.succeed({ error: toHttpError(error), kind: "error" } as const),
			MeetingNotFound: (error) =>
				Effect.succeed({ error: toHttpError(error), kind: "error" } as const),
			UnsupportedMediaType: (error) =>
				Effect.succeed({ error: toHttpError(error), kind: "error" } as const),
			InvalidContentLength: (error) =>
				Effect.succeed({ error: toHttpError(error), kind: "error" } as const),
			EmptyAudio: (error) =>
				Effect.succeed({ error: toHttpError(error), kind: "error" } as const),
			AudioTooLarge: (error) =>
				Effect.succeed({ error: toHttpError(error), kind: "error" } as const),
			InvalidAudioBody: (error) =>
				Effect.succeed({ error: toHttpError(error), kind: "error" } as const),
			StorageFailure: (error) =>
				Effect.gen(function* () {
					if (error.meetingId !== null) {
						yield* markUploadFailed(error.meetingId);
					}
					return { error: toHttpError(error), kind: "error" } as const;
				}),
		})
	);
}

function resolveMeetingAudio(
	meetingIdParam: string
): Effect.Effect<Outcome<ResolvedAudio>, never> {
	const program = Effect.gen(function* () {
		const meetingId = yield* parseMeetingId(meetingIdParam);
		const db = yield* makeDb();
		const row = yield* findMeetingById(db, meetingId);
		if (!row.audioKey) {
			return yield* Effect.fail(audioNotFound());
		}
		const stored = yield* Effect.tryPromise({
			try: () => env.AUDIO_BUCKET.get(row.audioKey as string),
			catch: (cause): StorageFailure => storageFailure(cause, meetingId),
		});
		if (!stored) {
			return yield* Effect.fail(audioNotFound());
		}

		return {
			data: {
				body: stored.body,
				mimeType:
					row.audioMimeType ??
					stored.httpMetadata?.contentType ??
					"application/octet-stream",
				size: stored.size,
			},
			kind: "success",
		} as const;
	});

	return program.pipe(
		Effect.catchTags({
			InvalidMeetingId: (error) =>
				Effect.succeed({ error: toHttpError(error), kind: "error" } as const),
			MeetingNotFound: (error) =>
				Effect.succeed({ error: toHttpError(error), kind: "error" } as const),
			AudioNotFound: (error) =>
				Effect.succeed({ error: toHttpError(error), kind: "error" } as const),
			StorageFailure: (error) =>
				Effect.succeed({ error: toHttpError(error), kind: "error" } as const),
		})
	);
}

const meetingsRouter = new Hono();

meetingsRouter.get("/api/meetings", async (c) => {
	const outcome = await Effect.runPromise(listMeetings());

	if (outcome.kind === "error") {
		return c.json(
			{ error: { code: outcome.error.code, message: outcome.error.message } },
			outcome.error.status
		);
	}

	return c.json({ meetings: outcome.data });
});

meetingsRouter.post("/api/meetings", async (c) => {
	let raw: unknown;
	try {
		raw = await c.req.json();
	} catch {
		const error = toHttpError(invalidBody("The request body is invalid."));
		return c.json(
			{ error: { code: error.code, message: error.message } },
			error.status
		);
	}

	const outcome = await Effect.runPromise(createMeeting(raw));

	if (outcome.kind === "error") {
		return c.json(
			{ error: { code: outcome.error.code, message: outcome.error.message } },
			outcome.error.status
		);
	}

	return c.json({ meeting: outcome.data }, 201);
});

meetingsRouter.get("/api/meetings/:meetingId", async (c) => {
	const outcome = await Effect.runPromise(getMeeting(c.req.param("meetingId")));

	if (outcome.kind === "error") {
		return c.json(
			{ error: { code: outcome.error.code, message: outcome.error.message } },
			outcome.error.status
		);
	}

	return c.json({ meeting: outcome.data });
});

meetingsRouter.put("/api/meetings/:meetingId/audio", async (c) => {
	const contentType = c.req
		.header("content-type")
		?.split(";", 1)[0]
		?.trim()
		.toLowerCase();
	let outcome: Outcome<PublicMeeting>;
	try {
		outcome = await Effect.runPromise(
			putMeetingAudio(
				c.req.param("meetingId"),
				contentType,
				c.req.header("content-length"),
				c.req.raw.body
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

	return c.json({ meeting: outcome.data });
});

meetingsRouter.get("/api/meetings/:meetingId/audio", async (c) => {
	const outcome = await Effect.runPromise(
		resolveMeetingAudio(c.req.param("meetingId"))
	);

	if (outcome.kind === "error") {
		return c.json(
			{ error: { code: outcome.error.code, message: outcome.error.message } },
			outcome.error.status
		);
	}

	return new Response(outcome.data.body, {
		headers: {
			"Accept-Ranges": "none",
			"Content-Length": String(outcome.data.size),
			"Content-Type": outcome.data.mimeType,
		},
	});
});

export default meetingsRouter;
