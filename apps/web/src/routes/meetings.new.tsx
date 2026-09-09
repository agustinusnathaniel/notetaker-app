import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@notetaker-app/ui/components/alert";
import { Button } from "@notetaker-app/ui/components/button";
import {
	Card,
	CardDescription,
	CardHeader,
	CardPanel,
	CardTitle,
} from "@notetaker-app/ui/components/card";
import {
	Field,
	FieldDescription,
	FieldError,
	FieldLabel,
} from "@notetaker-app/ui/components/field";
import { Input } from "@notetaker-app/ui/components/input";
import {
	Progress,
	ProgressIndicator,
	ProgressLabel,
	ProgressTrack,
	ProgressValue,
} from "@notetaker-app/ui/components/progress";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { CircleAlertIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
	createMeeting,
	mimeTypeForFilename,
	requestSummary,
	requestTranscription,
	uploadAudio,
} from "@/lib/meetings";

export const Route = createFileRoute("/meetings/new")({
	component: NewMeeting,
});

const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const ACCEPT_VALUE = ".mp3,.wav,.m4a,.ogg,.oga,.opus,.flac,.aac,.webm";

const ALLOWED_MIME_TYPES: ReadonlySet<string> = new Set([
	"audio/aac",
	"audio/flac",
	"audio/mp4",
	"audio/mpeg",
	"audio/ogg",
	"audio/opus",
	"audio/wav",
	"audio/wave",
	"audio/webm",
	"audio/x-aac",
	"audio/x-flac",
	"audio/x-m4a",
	"audio/x-wav",
]);

const ALLOWED_EXTENSIONS: ReadonlySet<string> = new Set([
	"aac",
	"flac",
	"m4a",
	"mp3",
	"oga",
	"ogg",
	"opus",
	"wav",
	"webm",
]);

type UploadStage =
	| "idle"
	| "creating"
	| "uploading"
	| "transcribing"
	| "summarizing"
	| "completed"
	| "failed";

const STAGE_LABELS: Record<UploadStage, string> = {
	completed: "Completed",
	creating: "Creating meeting",
	failed: "Failed",
	idle: "Choose an audio file to get started",
	summarizing: "Summarizing",
	transcribing: "Transcribing",
	uploading: "Uploading audio",
};

const STAGE_PROGRESS: Record<Exclude<UploadStage, "failed">, number> = {
	completed: 100,
	creating: 15,
	idle: 0,
	summarizing: 90,
	transcribing: 70,
	uploading: 40,
};

function extensionFor(filename: string): string {
	const extension = filename.split(".").pop()?.trim().toLowerCase() ?? "";
	return extension;
}

function validateAudioFile(file: File): string | null {
	if (file.size === 0) {
		return "The selected file is empty. Choose a non-empty audio file.";
	}
	if (file.size > MAX_AUDIO_BYTES) {
		return "Audio files must be 25 MiB or smaller.";
	}
	if (file.type) {
		if (!ALLOWED_MIME_TYPES.has(file.type.toLowerCase())) {
			return "Unsupported audio type. Choose an MP3, WAV, M4A, OGG, OPUS, FLAC, AAC, or WebM file.";
		}
		return null;
	}
	const extension = extensionFor(file.name);
	if (!ALLOWED_EXTENSIONS.has(extension)) {
		return "Unsupported audio type. Choose an MP3, WAV, M4A, OGG, OPUS, FLAC, AAC, or WebM file.";
	}
	const inferred = mimeTypeForFilename(file.name);
	if (!(inferred && ALLOWED_MIME_TYPES.has(inferred))) {
		return "Unsupported audio type. Choose an MP3, WAV, M4A, OGG, OPUS, FLAC, AAC, or WebM file.";
	}
	return null;
}

function isSubmittingStage(stage: UploadStage): boolean {
	return (
		stage === "creating" ||
		stage === "uploading" ||
		stage === "transcribing" ||
		stage === "summarizing"
	);
}

async function advanceMeetingPipeline(
	file: File,
	durationSeconds: number,
	signal: AbortSignal,
	onStage: (stage: UploadStage) => void
): Promise<string> {
	onStage("creating");
	const meeting = await createMeeting(file.name, durationSeconds, signal);
	onStage("uploading");
	await uploadAudio(meeting.id, file, signal);
	onStage("transcribing");
	await requestTranscription(meeting.id, signal);
	onStage("summarizing");
	await requestSummary(meeting.id, signal);
	return meeting.id;
}

function NewMeeting(): React.ReactElement {
	const navigate = useNavigate();
	const fileRef = useRef<File | null>(null);
	const objectUrlRef = useRef<string | null>(null);
	const abortRef = useRef<AbortController | null>(null);
	const [fileName, setFileName] = useState<string | null>(null);
	const [durationSeconds, setDurationSeconds] = useState<number>(0);
	const [fieldError, setFieldError] = useState<string | null>(null);
	const [failure, setFailure] = useState<string | null>(null);
	const [stage, setStage] = useState<UploadStage>("idle");

	const revokeObjectUrl = useCallback((): void => {
		const { current }: { current: string | null } = objectUrlRef;
		if (current) {
			URL.revokeObjectURL(current);
			objectUrlRef.current = null;
		}
	}, []);

	useEffect(
		() => () => {
			revokeObjectUrl();
			abortRef.current?.abort();
		},
		[revokeObjectUrl]
	);

	const probeDuration = useCallback(
		(file: File): void => {
			revokeObjectUrl();
			const objectUrl = URL.createObjectURL(file);
			objectUrlRef.current = objectUrl;
			const audio = new Audio();
			audio.preload = "metadata";
			audio.onloadedmetadata = () => {
				const { duration } = audio;
				if (Number.isFinite(duration) && duration > 0) {
					setDurationSeconds(Math.floor(duration));
				} else {
					setDurationSeconds(0);
				}
			};
			audio.onerror = () => {
				setDurationSeconds(0);
			};
			audio.src = objectUrl;
		},
		[revokeObjectUrl]
	);

	const handleFileChange = useCallback(
		(event: React.ChangeEvent<HTMLInputElement>): void => {
			const selected = event.target.files?.[0] ?? null;
			fileRef.current = selected;
			setFailure(null);
			setStage("idle");
			if (!selected) {
				setFileName(null);
				setDurationSeconds(0);
				revokeObjectUrl();
				return;
			}
			setFileName(selected.name);
			setDurationSeconds(0);
			const error = validateAudioFile(selected);
			setFieldError(error);
			probeDuration(selected);
		},
		[probeDuration, revokeObjectUrl]
	);

	const runUpload = useCallback(async (): Promise<void> => {
		const file: File | null = fileRef.current;
		if (!file) {
			setFieldError("Please choose an audio file.");
			return;
		}
		const validationError = validateAudioFile(file);
		if (validationError) {
			setFieldError(validationError);
			return;
		}
		const { current: inFlight }: { current: AbortController | null } = abortRef;
		if (inFlight) {
			inFlight.abort();
		}
		const controller = new AbortController();
		abortRef.current = controller;
		const { signal } = controller;
		setFieldError(null);
		setFailure(null);
		try {
			const meetingId = await advanceMeetingPipeline(
				file,
				durationSeconds,
				signal,
				setStage
			);
			setStage("completed");
			await navigate({
				params: { meetingId },
				to: "/meetings/$meetingId",
			});
		} catch (error: unknown) {
			if (signal.aborted) {
				return;
			}
			const message =
				error instanceof Error
					? error.message
					: "Something went wrong. Please try again.";
			setFailure(message);
			setStage("failed");
			toast.error(message);
		} finally {
			if (abortRef.current === controller) {
				abortRef.current = null;
			}
		}
	}, [durationSeconds, navigate]);

	const handleSubmit = useCallback(
		(event: React.FormEvent<HTMLFormElement>): void => {
			event.preventDefault();
			runUpload().catch(() => undefined);
		},
		[runUpload]
	);

	const isSubmitting = isSubmittingStage(stage);
	const describedBy = fieldError ? "audio-file-error" : undefined;
	const progressValue = stage === "failed" ? undefined : STAGE_PROGRESS[stage];

	return (
		<main className="container mx-auto w-full max-w-3xl px-4 py-6">
			<section
				aria-labelledby="new-meeting-title"
				className="flex flex-col gap-4"
			>
				<div className="flex flex-wrap items-center justify-between gap-3">
					<h1 className="font-semibold text-xl" id="new-meeting-title">
						New meeting
					</h1>
					<Button render={<Link to="/" />} variant="ghost">
						Back Home
					</Button>
				</div>

				<Card>
					<CardHeader>
						{/* biome-ignore lint/a11y/useHeadingContent: CardTitle renders an h2 with the upload title as content. */}
						<CardTitle render={<h2 />}>Upload audio</CardTitle>
						<CardDescription>
							Upload an audio file up to 25 MiB. Notes generate automatically,
							then you return to the meeting detail page. If you leave, retry
							from the meeting detail page.
						</CardDescription>
					</CardHeader>
					<CardPanel>
						<form className="flex flex-col gap-4" onSubmit={handleSubmit}>
							<Field invalid={!!fieldError}>
								<FieldLabel htmlFor="audio-file">Audio file</FieldLabel>
								<Input
									accept={ACCEPT_VALUE}
									aria-describedby={describedBy}
									aria-invalid={fieldError ? true : undefined}
									disabled={isSubmitting}
									id="audio-file"
									onChange={handleFileChange}
									type="file"
								/>
								{fieldError ? (
									<FieldError id="audio-file-error" match={true}>
										{fieldError}
									</FieldError>
								) : null}
								<FieldDescription>
									Upload an MP3, WAV, M4A, OGG, OPUS, FLAC, AAC, or WebM file up
									to 25 MiB.
								</FieldDescription>
								{fileName ? (
									<FieldDescription>
										Selected: {fileName}
										{durationSeconds > 0
											? ` · about ${String(durationSeconds)}s`
											: null}
									</FieldDescription>
								) : null}
							</Field>

							{progressValue === undefined ? null : (
								<Progress value={progressValue}>
									<div className="flex items-center justify-between gap-2">
										<ProgressLabel>Status: {STAGE_LABELS[stage]}</ProgressLabel>
										<ProgressValue />
									</div>
									<ProgressTrack>
										<ProgressIndicator />
									</ProgressTrack>
								</Progress>
							)}

							{failure ? (
								<Alert variant="error">
									<CircleAlertIcon />
									<AlertTitle>Upload failed</AlertTitle>
									<AlertDescription>{failure}</AlertDescription>
								</Alert>
							) : null}

							<div className="flex flex-wrap gap-2">
								<Button
									disabled={isSubmitting}
									loading={isSubmitting}
									type="submit"
								>
									{stage === "failed"
										? "Retry upload"
										: "Upload and generate notes"}
								</Button>
							</div>
						</form>
					</CardPanel>
				</Card>
			</section>
		</main>
	);
}
