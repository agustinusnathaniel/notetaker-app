import { env } from "@notetaker-app/env/web";

export interface TranscriptSegment {
	end: number;
	speaker: number | null;
	start: number;
	text: string;
}

export interface ActionItem {
	owner: string | null;
	text: string;
}

export type MeetingStatus =
	| "draft"
	| "uploading"
	| "transcribing"
	| "summarizing"
	| "completed"
	| "failed";

export type FailedStage = "upload" | "transcription" | "summary" | null;

export interface PublicMeeting {
	readonly actionItems: ActionItem[];
	readonly audioAvailable: boolean;
	readonly audioBytes: number | null;
	readonly audioMimeType: string | null;
	readonly createdAt: string;
	readonly description: string | null;
	readonly durationSeconds: number;
	readonly failedStage: FailedStage;
	readonly id: string;
	readonly occurredAt: string;
	readonly source: "upload" | "recording" | "demo";
	readonly status: MeetingStatus;
	readonly summary: string | null;
	readonly takeaways: string[];
	readonly title: string;
	readonly transcript: string | null;
	readonly transcriptSegments: TranscriptSegment[];
	readonly updatedAt: string;
}

export interface ApiError {
	code: string;
	message: string;
}

export class MeetingApiError extends Error {
	readonly code: string;

	constructor(error: ApiError) {
		super(error.message);
		this.code = error.code;
		this.name = "MeetingApiError";
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

export function getApiError(body: unknown): ApiError | null {
	if (!(isRecord(body) && isRecord(body.error))) {
		return null;
	}

	const { code, message } = body.error;
	if (typeof code !== "string" || typeof message !== "string") {
		return null;
	}

	return { code, message };
}

const NOT_FOUND_CODES: ReadonlySet<string> = new Set([
	"meeting_not_found",
	"invalid_meeting_id",
]);

export function isNotFoundError(error: unknown): boolean {
	return error instanceof MeetingApiError && NOT_FOUND_CODES.has(error.code);
}

function isPublicMeeting(value: unknown): value is PublicMeeting {
	return (
		isRecord(value) &&
		typeof value.id === "string" &&
		typeof value.title === "string"
	);
}

function parseMeetingsList(body: unknown): PublicMeeting[] {
	if (isRecord(body) && Array.isArray(body.meetings)) {
		return body.meetings.filter(isPublicMeeting);
	}
	throw new MeetingApiError({
		code: "invalid_response",
		message: "The meetings service returned an invalid response.",
	});
}

function parseMeetingDetail(body: unknown): PublicMeeting {
	if (isRecord(body) && isPublicMeeting(body.meeting)) {
		return body.meeting;
	}
	throw new MeetingApiError({
		code: "invalid_response",
		message: "The meetings service returned an invalid response.",
	});
}

async function parseErrorResponse(response: Response): Promise<never> {
	let body: unknown = null;
	try {
		body = (await response.json()) as unknown;
	} catch {
		body = null;
	}
	const apiError = getApiError(body);
	throw new MeetingApiError(
		apiError ?? {
			code: "unknown_error",
			message: "Something went wrong. Please try again.",
		}
	);
}

export async function fetchMeetings(
	signal?: AbortSignal
): Promise<PublicMeeting[]> {
	const response = await fetch(`${env.VITE_SERVER_URL}/api/meetings`, {
		signal,
	});
	if (!response.ok) {
		await parseErrorResponse(response);
	}
	const body: unknown = await response.json();
	return parseMeetingsList(body);
}

export async function fetchMeeting(
	meetingId: string,
	signal?: AbortSignal
): Promise<PublicMeeting> {
	const response = await fetch(
		`${env.VITE_SERVER_URL}/api/meetings/${meetingId}`,
		{ signal }
	);
	if (!response.ok) {
		await parseErrorResponse(response);
	}
	const body: unknown = await response.json();
	return parseMeetingDetail(body);
}

export function audioUrlFor(serverUrl: string, meetingId: string): string {
	return `${serverUrl}/api/meetings/${meetingId}/audio`;
}

export function formatDate(isoDate: string): string {
	const time = Date.parse(isoDate);
	if (Number.isNaN(time)) {
		return "Unknown date";
	}
	return new Date(time).toLocaleDateString(undefined, {
		day: "numeric",
		month: "short",
		year: "numeric",
	});
}

export function formatDuration(durationSeconds: number): string {
	if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
		return "Unknown duration";
	}
	const total = Math.floor(durationSeconds);
	const hours = Math.floor(total / 3600);
	const minutes = Math.floor((total % 3600) / 60);
	const seconds = total % 60;
	if (hours > 0) {
		return `${String(hours)}h ${String(minutes)}m`;
	}
	if (minutes > 0) {
		return `${String(minutes)}m ${String(seconds).padStart(2, "0")}s`;
	}
	return `${String(seconds)}s`;
}
