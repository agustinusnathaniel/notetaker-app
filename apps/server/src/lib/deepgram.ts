import type { TranscriptSegment } from "@notetaker-app/db/schema/index";
import { z } from "zod";

export const DEEPGRAM_LISTEN_URL =
	"https://api.deepgram.com/v1/listen?model=nova-3&language=en-US&smart_format=true&utterances=true&diarize_model=latest";
// Diarization is enabled by diarize_model alone. Do not add diarize=true:
// Deepgram rejects requests that set both, and diarize=true alone pins to v1.

const DeepgramUtteranceSchema = z.object({
	end: z.number(),
	speaker: z.number().int().nullable().optional(),
	start: z.number(),
	transcript: z.string(),
});

const DeepgramResponseSchema = z.object({
	metadata: z.object({ request_id: z.string().optional() }).optional(),
	results: z.object({
		channels: z
			.array(
				z.object({
					alternatives: z.array(z.object({ transcript: z.string() })).min(1),
				})
			)
			.min(1),
		utterances: z.array(DeepgramUtteranceSchema).optional(),
	}),
});

export interface NormalizedTranscript {
	readonly segments: TranscriptSegment[];
	readonly transcript: string;
}

function toSegment(
	utterance: z.infer<typeof DeepgramUtteranceSchema>
): TranscriptSegment | null {
	const text = utterance.transcript.trim();
	if (!text) {
		return null;
	}

	return {
		end: utterance.end,
		speaker: utterance.speaker ?? null,
		start: utterance.start,
		text,
	};
}

export function normalizeDeepgramResponse(
	payload: unknown
): NormalizedTranscript | null {
	const parsed = DeepgramResponseSchema.safeParse(payload);
	if (!parsed.success) {
		return null;
	}

	const [channel] = parsed.data.results.channels;
	const [alternative] = channel?.alternatives ?? [];
	const transcript = alternative?.transcript.trim() ?? "";
	if (!transcript) {
		return null;
	}

	const utterances = parsed.data.results.utterances ?? [];
	const segments: TranscriptSegment[] = [];
	for (const utterance of utterances) {
		const segment = toSegment(utterance);
		if (segment) {
			segments.push(segment);
		}
	}
	segments.sort((a, b) => a.start - b.start);

	if (segments.length === 0) {
		return {
			segments: [{ end: 0, speaker: null, start: 0, text: transcript }],
			transcript,
		};
	}

	return { segments, transcript };
}
