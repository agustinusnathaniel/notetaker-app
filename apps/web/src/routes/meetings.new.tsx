import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@notetaker-app/ui/components/alert";
import { Button } from "@notetaker-app/ui/components/button";
import {
	Card,
	CardFrame,
	CardFrameDescription,
	CardFrameFooter,
	CardFrameHeader,
	CardFrameTitle,
	CardPanel,
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
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@notetaker-app/ui/components/tooltip";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
	CheckIcon,
	ChevronLeftIcon,
	CircleAlertIcon,
	InfoIcon,
	MicIcon,
	SquareIcon,
	Trash2Icon,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
	createMeeting,
	type MeetingSource,
	mimeEssence,
	mimeTypeForFilename,
	requestSummary,
	requestTranscription,
	uploadAudio,
} from "@/lib/meetings";

export const Route = createFileRoute("/meetings/new")({
	component: NewMeeting,
});

const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
// Warn at ~20 MiB so the speaker can wrap up before the hard cap stops capture.
const RECORD_WARN_BYTES = 20 * 1024 * 1024;
// Capacity math (documented for the 1-2hr guidance below): Opus 32kbps is
// 4KB/s, so 1hr is ~14.4MB and fits ~1.8hr in 25MiB. At 64kbps 1hr is
// ~28.8MB, exceeding the cap at ~55min. Chrome MediaRecorder defaults run
// ~50-128kbps, capping recordings at ~27-60min. MP3 128k caps at ~27min,
// WAV mono 16-bit/44.1kHz (~86KB/s) at ~5min, stereo at ~2.5min.
const ACCEPT_VALUE = ".mp3,.wav,.m4a,.ogg,.oga,.opus,.flac,.aac,.webm";

const RECORD_MIME_CANDIDATES: readonly string[] = [
	"audio/webm;codecs=opus",
	"audio/webm",
	"audio/ogg;codecs=opus",
];

type AudioSourceTab = "upload" | "record";

const SOURCE_TITLES: Record<AudioSourceTab, string> = {
	record: "Record audio",
	upload: "Upload audio",
};

const SOURCE_DESCRIPTIONS: Record<AudioSourceTab, string> = {
	record:
		"Record audio with your microphone, then generate notes automatically.",
	upload:
		"Upload an audio file up to 25 MiB. Notes generate automatically, then you return to the meeting detail page. If you leave, retry from the meeting detail page.",
};

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
		if (!ALLOWED_MIME_TYPES.has(mimeEssence(file.type))) {
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

function pickRecordingMimeType(): string | undefined {
	if (
		typeof MediaRecorder === "undefined" ||
		typeof MediaRecorder.isTypeSupported !== "function"
	) {
		return undefined;
	}
	for (const candidate of RECORD_MIME_CANDIDATES) {
		try {
			if (MediaRecorder.isTypeSupported(candidate)) {
				return candidate;
			}
		} catch {
			// Ignore unsupported MIME probes and try the next candidate.
		}
	}
	return undefined;
}

function formatRecordingTime(totalSeconds: number): string {
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	return `${String(minutes)}:${String(seconds).padStart(2, "0")}`;
}

function formatMegabytes(bytes: number): string {
	return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function microphoneErrorMessage(error: unknown): string {
	const name =
		error instanceof DOMException || error instanceof Error ? error.name : "";
	if (name === "NotAllowedError") {
		return "Microphone access was denied. Allow microphone access or upload a file instead.";
	}
	if (name === "NotFoundError") {
		return "No microphone was found. Connect a microphone or upload a file instead.";
	}
	if (name === "NotReadableError" || name === "AbortError") {
		return "Could not start recording with this microphone. Try again or upload a file instead.";
	}
	if (name === "SecurityError") {
		return "Recording is blocked in this context. Upload a file instead.";
	}
	return "Could not start recording. Try again or upload a file instead.";
}

function submitErrorMessage(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}
	return "Something went wrong. Please try again.";
}

function stopStreamTracks(stream: MediaStream | null): void {
	if (stream) {
		for (const track of stream.getTracks()) {
			track.stop();
		}
	}
}

function extensionForEssence(essence: string): string {
	if (essence.includes("ogg")) {
		return "ogg";
	}
	if (essence.includes("mp4")) {
		return "m4a";
	}
	return "webm";
}

function buildRecordingFile(chunks: Blob[], mimeType: string): File {
	const essence = mimeEssence(mimeType) || "audio/webm";
	const blob = new Blob(chunks, { type: essence });
	const extension = extensionForEssence(essence);
	return new File([blob], `recording-${String(Date.now())}.${extension}`, {
		type: essence,
	});
}

function nextAbortController(reference: {
	current: AbortController | null;
}): AbortController {
	reference.current?.abort();
	const controller = new AbortController();
	reference.current = controller;
	return controller;
}

interface RecordingReady {
	elapsedSeconds: number;
	file: File;
}

interface AudioRecorder {
	capReached: boolean;
	discardRecording: () => void;
	isRecording: boolean;
	pendingRecording: File | null;
	recordError: string | null;
	recordedBytes: number;
	recordedUrl: string | null;
	recordingSeconds: number;
	startRecording: () => Promise<void>;
	stopRecording: () => void;
}

function useAudioRecorder(options: {
	onRecordingReady: (ready: RecordingReady) => void;
}): AudioRecorder {
	const { onRecordingReady } = options;
	const mediaRecorderRef = useRef<MediaRecorder | null>(null);
	const streamRef = useRef<MediaStream | null>(null);
	const chunksRef = useRef<Blob[]>([]);
	const timerRef = useRef<number | null>(null);
	const recordedUrlRef = useRef<string | null>(null);
	const recordingSecondsRef = useRef<number>(0);
	const recordedBytesRef = useRef<number>(0);
	const [isRecording, setIsRecording] = useState<boolean>(false);
	const [recordingSeconds, setRecordingSeconds] = useState<number>(0);
	const [recordedBytes, setRecordedBytes] = useState<number>(0);
	const [capReached, setCapReached] = useState<boolean>(false);
	const [recordedUrl, setRecordedUrl] = useState<string | null>(null);
	const [recordError, setRecordError] = useState<string | null>(null);
	const [pendingRecording, setPendingRecording] = useState<File | null>(null);

	const revokeRecordedUrl = useCallback((): void => {
		const { current }: { current: string | null } = recordedUrlRef;
		if (current) {
			URL.revokeObjectURL(current);
			recordedUrlRef.current = null;
		}
	}, []);

	const stopMediaTracks = useCallback((): void => {
		stopStreamTracks(streamRef.current);
		streamRef.current = null;
	}, []);

	const stopTimer = useCallback((): void => {
		if (timerRef.current !== null) {
			window.clearInterval(timerRef.current);
			timerRef.current = null;
		}
	}, []);

	useEffect(
		() => () => {
			stopTimer();
			revokeRecordedUrl();
			const recorder: MediaRecorder | null = mediaRecorderRef.current;
			mediaRecorderRef.current = null;
			if (recorder && recorder.state !== "inactive") {
				try {
					recorder.stop();
				} catch {
					// Ignore stop errors during unmount.
				}
			}
			stopStreamTracks(streamRef.current);
			streamRef.current = null;
		},
		[revokeRecordedUrl, stopTimer]
	);

	const startRecording = useCallback(async (): Promise<void> => {
		if (isRecording) {
			return;
		}
		setRecordError(null);
		if (
			typeof MediaRecorder === "undefined" ||
			typeof navigator === "undefined" ||
			!navigator.mediaDevices?.getUserMedia
		) {
			setRecordError(
				"Recording is not available in this browser. Upload a file instead."
			);
			return;
		}
		try {
			const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
			streamRef.current = stream;
			chunksRef.current = [];
			recordedBytesRef.current = 0;
			setRecordedBytes(0);
			setCapReached(false);
			const mimeType = pickRecordingMimeType();
			const recorder = mimeType
				? new MediaRecorder(stream, { mimeType })
				: new MediaRecorder(stream);
			mediaRecorderRef.current = recorder;
			recordingSecondsRef.current = 0;
			setRecordingSeconds(0);
			recorder.ondataavailable = (event: BlobEvent): void => {
				if (event.data.size > 0) {
					chunksRef.current.push(event.data);
					recordedBytesRef.current += event.data.size;
					setRecordedBytes(recordedBytesRef.current);
					if (recordedBytesRef.current >= MAX_AUDIO_BYTES) {
						setCapReached(true);
						setIsRecording(false);
						stopTimer();
						if (recorder.state !== "inactive") {
							try {
								recorder.stop();
							} catch {
								// onstop errors surface through stopRecording handling.
							}
						}
					}
				}
			};
			recorder.onstop = (): void => {
				if (mediaRecorderRef.current !== recorder) {
					return;
				}
				mediaRecorderRef.current = null;
				const file = buildRecordingFile(
					chunksRef.current,
					recorder.mimeType || "audio/webm"
				);
				setPendingRecording(file);
				revokeRecordedUrl();
				const url = URL.createObjectURL(file);
				recordedUrlRef.current = url;
				setRecordedUrl(url);
				onRecordingReady({
					elapsedSeconds: recordingSecondsRef.current,
					file,
				});
				stopMediaTracks();
			};
			recorder.start(1000);
			setIsRecording(true);
			stopTimer();
			timerRef.current = window.setInterval(() => {
				recordingSecondsRef.current += 1;
				setRecordingSeconds(recordingSecondsRef.current);
			}, 1000);
		} catch (error: unknown) {
			stopMediaTracks();
			mediaRecorderRef.current = null;
			setRecordError(microphoneErrorMessage(error));
		}
	}, [
		isRecording,
		onRecordingReady,
		revokeRecordedUrl,
		stopMediaTracks,
		stopTimer,
	]);

	const stopRecording = useCallback((): void => {
		const recorder: MediaRecorder | null = mediaRecorderRef.current;
		setIsRecording(false);
		stopTimer();
		if (recorder && recorder.state !== "inactive") {
			try {
				recorder.stop();
			} catch {
				setRecordError(
					"Could not finish the recording. Try again or upload a file instead."
				);
				stopMediaTracks();
				mediaRecorderRef.current = null;
			}
		} else {
			stopMediaTracks();
		}
	}, [stopMediaTracks, stopTimer]);

	const discardRecording = useCallback((): void => {
		setPendingRecording(null);
		revokeRecordedUrl();
		setRecordedUrl(null);
		recordingSecondsRef.current = 0;
		setRecordingSeconds(0);
		recordedBytesRef.current = 0;
		setRecordedBytes(0);
		setCapReached(false);
		setRecordError(null);
	}, [revokeRecordedUrl]);

	return {
		capReached,
		discardRecording,
		isRecording,
		pendingRecording,
		recordError,
		recordedBytes,
		recordedUrl,
		recordingSeconds,
		startRecording,
		stopRecording,
	};
}

async function advanceMeetingPipeline(
	file: File,
	durationSeconds: number,
	signal: AbortSignal,
	onStage: (stage: UploadStage) => void,
	source: MeetingSource = "upload"
): Promise<string> {
	onStage("creating");
	const meeting = await createMeeting(
		file.name,
		durationSeconds,
		signal,
		source
	);
	onStage("uploading");
	await uploadAudio(meeting.id, file, signal);
	onStage("transcribing");
	await requestTranscription(meeting.id, signal);
	onStage("summarizing");
	await requestSummary(meeting.id, signal);
	return meeting.id;
}

interface SourceToggleProps {
	disabled: boolean;
	onSelectRecord: () => void;
	onSelectUpload: () => void;
	value: AudioSourceTab;
}

function SourceToggle(props: SourceToggleProps): React.ReactElement {
	const { disabled, onSelectRecord, onSelectUpload, value } = props;
	return (
		<fieldset className="flex gap-1">
			<legend className="sr-only">Audio source</legend>
			<Button
				aria-pressed={value === "upload"}
				disabled={disabled}
				onClick={onSelectUpload}
				type="button"
				variant={value === "upload" ? "secondary" : "ghost"}
			>
				Upload
			</Button>
			<Button
				aria-pressed={value === "record"}
				disabled={disabled}
				onClick={onSelectRecord}
				type="button"
				variant={value === "record" ? "secondary" : "ghost"}
			>
				Record
			</Button>
		</fieldset>
	);
}

interface UploadPanelProps {
	disabled: boolean;
	durationSeconds: number;
	fieldError: string | null;
	fileName: string | null;
	onFileChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
}

function UploadPanel(props: UploadPanelProps): React.ReactElement {
	const { disabled, durationSeconds, fieldError, fileName, onFileChange } =
		props;
	const describedBy = fieldError ? "audio-file-error" : undefined;
	return (
		<Field invalid={!!fieldError}>
			<div className="flex items-center gap-1.5">
				<FieldLabel htmlFor="audio-file">Audio file</FieldLabel>
				<Tooltip>
					<TooltipTrigger
						aria-label="Audio file size limit"
						className="inline-flex items-center justify-center rounded-sm text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
						render={<button type="button" />}
					>
						<InfoIcon aria-hidden="true" className="size-3.5" />
					</TooltipTrigger>
					<TooltipContent>25 MiB max</TooltipContent>
				</Tooltip>
			</div>
			<Input
				accept={ACCEPT_VALUE}
				aria-describedby={describedBy}
				aria-invalid={fieldError ? true : undefined}
				disabled={disabled}
				id="audio-file"
				onChange={onFileChange}
				type="file"
			/>
			{fieldError ? (
				<FieldError id="audio-file-error" match={true}>
					{fieldError}
				</FieldError>
			) : null}
			<FieldDescription>
				Upload an MP3, WAV, M4A, OGG, OPUS, FLAC, AAC, or WebM file up to 25
				MiB.
			</FieldDescription>
			{fileName ? (
				<FieldDescription>
					Selected: {fileName}
					{durationSeconds > 0 ? ` · about ${String(durationSeconds)}s` : null}
				</FieldDescription>
			) : null}
		</Field>
	);
}

interface RecordingPanelProps {
	capReached: boolean;
	disabled: boolean;
	durationSeconds: number;
	fieldError: string | null;
	fileName: string | null;
	isRecordedFile: boolean;
	isRecording: boolean;
	onDiscard: () => void;
	onRecordStart: () => void;
	onRecordStop: () => void;
	onUseRecording: () => void;
	recordError: string | null;
	recordedBytes: number;
	recordedUrl: string | null;
	recordingSeconds: number;
}

function RecordingCapNotices({
	capReached,
	isRecording,
	recordedBytes,
}: {
	readonly capReached: boolean;
	readonly isRecording: boolean;
	readonly recordedBytes: number;
}): React.ReactElement | null {
	if (capReached) {
		return (
			<Alert variant="warning">
				<CircleAlertIcon />
				<AlertTitle>Recording cap reached</AlertTitle>
				<AlertDescription>
					Recording stopped at the 25 MiB cap. Submit what you have below; the
					server also enforces the 25 MiB limit.
				</AlertDescription>
			</Alert>
		);
	}
	if (isRecording && recordedBytes >= RECORD_WARN_BYTES) {
		return (
			<Alert variant="warning">
				<CircleAlertIcon />
				<AlertTitle>Approaching the size limit</AlertTitle>
				<AlertDescription>
					Recording is at {formatMegabytes(recordedBytes)} of 25 MiB. Wrap up
					soon; recording stops automatically at the cap and you can submit what
					you have.
				</AlertDescription>
			</Alert>
		);
	}
	return null;
}

function RecordingPanel(props: RecordingPanelProps): React.ReactElement {
	const {
		capReached,
		disabled,
		durationSeconds,
		fieldError,
		fileName,
		isRecordedFile,
		isRecording,
		onDiscard,
		onRecordStart,
		onRecordStop,
		onUseRecording,
		recordError,
		recordedBytes,
		recordedUrl,
		recordingSeconds,
	} = props;
	const showRecordButton = !(isRecording || recordedUrl);
	const showTimer = isRecording || recordedUrl !== null;
	const timerLabel = isRecording ? "Recording" : "Recorded";
	const useLabel = isRecordedFile ? "Recording ready" : "Use recording";
	return (
		<Field invalid={!!fieldError}>
			<FieldLabel htmlFor="record-button">Microphone recording</FieldLabel>
			<div className="flex flex-wrap items-center gap-2">
				{isRecording ? (
					<Button onClick={onRecordStop} type="button" variant="destructive">
						<SquareIcon aria-hidden="true" />
						Stop
					</Button>
				) : null}
				{showRecordButton ? (
					<Button
						disabled={disabled}
						id="record-button"
						onClick={onRecordStart}
						type="button"
					>
						<MicIcon aria-hidden="true" />
						Record
					</Button>
				) : null}
				{showTimer ? (
					<p aria-live="polite" className="text-muted-foreground text-sm">
						{timerLabel} {formatRecordingTime(recordingSeconds)}
						{isRecording
							? ` · ${formatMegabytes(recordedBytes)} / 25 MiB`
							: null}
					</p>
				) : null}
			</div>
			<RecordingCapNotices
				capReached={capReached}
				isRecording={isRecording}
				recordedBytes={recordedBytes}
			/>
			{recordedUrl && !isRecording ? (
				<div className="flex flex-col gap-2">
					{/* biome-ignore lint/a11y/useMediaCaption: preview plays the user's just-recorded audio; a transcript is generated after upload. */}
					<audio controls src={recordedUrl}>
						Your browser does not support audio preview.
					</audio>
					<div className="flex flex-wrap items-center gap-2">
						<Button onClick={onDiscard} type="button" variant="outline">
							<Trash2Icon aria-hidden="true" />
							Discard
						</Button>
						<Button
							disabled={disabled || isRecordedFile}
							onClick={onUseRecording}
							type="button"
						>
							<CheckIcon aria-hidden="true" />
							{useLabel}
						</Button>
					</div>
				</div>
			) : null}
			{fieldError ? (
				<FieldError id="recording-error" match={true}>
					{fieldError}
				</FieldError>
			) : null}
			<FieldDescription>
				Recordings are stored as WebM or OGG up to 25 MiB. Opus at 32kbps fits
				about 1.8hr (14.4MB/hr); Chrome defaults (50-128kbps) cap at about
				27-60min. Prefer a file? Switch to Upload instead.
			</FieldDescription>
			{fileName && isRecordedFile ? (
				<FieldDescription>
					Selected: {fileName}
					{durationSeconds > 0 ? ` · about ${String(durationSeconds)}s` : null}
				</FieldDescription>
			) : null}
			{recordError ? (
				<Alert variant="error">
					<CircleAlertIcon />
					<AlertTitle>Recording unavailable</AlertTitle>
					<AlertDescription>{recordError}</AlertDescription>
				</Alert>
			) : null}
		</Field>
	);
}

interface SubmissionStatusProps {
	failure: string | null;
	stage: UploadStage;
}

function SubmissionStatus(props: SubmissionStatusProps): React.ReactElement {
	const { failure, stage } = props;
	const progressValue = stage === "failed" ? undefined : STAGE_PROGRESS[stage];
	return (
		<>
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
		</>
	);
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
	const [audioSourceTab, setAudioSourceTab] =
		useState<AudioSourceTab>("upload");
	const [isRecordedFile, setIsRecordedFile] = useState<boolean>(false);

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

	const handleRecordingReady = useCallback(
		(ready: RecordingReady): void => {
			if (ready.elapsedSeconds > 0) {
				setDurationSeconds(ready.elapsedSeconds);
			} else {
				probeDuration(ready.file);
			}
		},
		[probeDuration]
	);

	const {
		capReached,
		discardRecording,
		isRecording,
		pendingRecording,
		recordedBytes,
		recordedUrl,
		recordError,
		recordingSeconds,
		startRecording,
		stopRecording,
	} = useAudioRecorder({ onRecordingReady: handleRecordingReady });

	const handleFileChange = useCallback(
		(event: React.ChangeEvent<HTMLInputElement>): void => {
			const selected = event.target.files?.[0] ?? null;
			fileRef.current = selected;
			setFailure(null);
			setStage("idle");
			setIsRecordedFile(false);
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

	const handleDiscardRecording = useCallback((): void => {
		discardRecording();
		if (isRecordedFile) {
			fileRef.current = null;
			setFileName(null);
			setDurationSeconds(0);
			setFieldError(null);
			setIsRecordedFile(false);
			revokeObjectUrl();
		}
		setStage("idle");
		setFailure(null);
	}, [discardRecording, isRecordedFile, revokeObjectUrl]);

	const handleUseRecording = useCallback((): void => {
		if (!pendingRecording) {
			return;
		}
		const error = validateAudioFile(pendingRecording);
		if (error) {
			setFieldError(error);
			return;
		}
		fileRef.current = pendingRecording;
		setFileName(pendingRecording.name);
		setFieldError(null);
		setFailure(null);
		setStage("idle");
		setIsRecordedFile(true);
	}, [pendingRecording]);

	const handleSelectUploadTab = useCallback((): void => {
		setAudioSourceTab("upload");
	}, []);

	const handleSelectRecordTab = useCallback((): void => {
		setAudioSourceTab("record");
	}, []);

	const handleRecordClick = useCallback((): void => {
		startRecording().catch(() => undefined);
	}, [startRecording]);

	const runUpload = useCallback(async (): Promise<void> => {
		if (isRecording) {
			return;
		}
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
		const controller = nextAbortController(abortRef);
		const { signal } = controller;
		const source: MeetingSource = isRecordedFile ? "recording" : "upload";
		setFieldError(null);
		setFailure(null);
		try {
			const meetingId = await advanceMeetingPipeline(
				file,
				durationSeconds,
				signal,
				setStage,
				source
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
			const message = submitErrorMessage(error);
			setFailure(message);
			setStage("failed");
			toast.error(message);
		} finally {
			if (abortRef.current === controller) {
				abortRef.current = null;
			}
		}
	}, [durationSeconds, isRecordedFile, isRecording, navigate]);

	const handleSubmit = useCallback(
		(event: React.FormEvent<HTMLFormElement>): void => {
			event.preventDefault();
			runUpload().catch(() => undefined);
		},
		[runUpload]
	);

	const isSubmitting = isSubmittingStage(stage);
	const controlsDisabled = isSubmitting || isRecording;
	const submitLabel =
		stage === "failed" ? "Retry upload" : "Upload and generate notes";

	return (
		<main className="container mx-auto w-full max-w-3xl px-4 py-6">
			<section
				aria-labelledby="new-meeting-title"
				className="flex flex-col gap-4"
			>
				<div className="flex flex-wrap items-center justify-between gap-3">
					<h1
						className="font-heading font-semibold text-xl"
						id="new-meeting-title"
					>
						New meeting
					</h1>
					<Button render={<Link to="/" />} variant="link">
						<ChevronLeftIcon aria-hidden="true" />
						Back Home
					</Button>
				</div>

				<CardFrame>
					<CardFrameHeader>
						{/* biome-ignore lint/a11y/useHeadingContent: CardFrameTitle renders an h2 with the upload title as content. */}
						<CardFrameTitle render={<h2 />}>
							{SOURCE_TITLES[audioSourceTab]}
						</CardFrameTitle>
						<CardFrameDescription>
							{SOURCE_DESCRIPTIONS[audioSourceTab]}
						</CardFrameDescription>
					</CardFrameHeader>
					<Card>
						<CardPanel>
							<form
								className="flex flex-col gap-4"
								id="audio-upload-form"
								onSubmit={handleSubmit}
							>
								<SourceToggle
									disabled={controlsDisabled}
									onSelectRecord={handleSelectRecordTab}
									onSelectUpload={handleSelectUploadTab}
									value={audioSourceTab}
								/>

								{audioSourceTab === "record" ? (
									<RecordingPanel
										capReached={capReached}
										disabled={isSubmitting}
										durationSeconds={durationSeconds}
										fieldError={fieldError}
										fileName={fileName}
										isRecordedFile={isRecordedFile}
										isRecording={isRecording}
										onDiscard={handleDiscardRecording}
										onRecordStart={handleRecordClick}
										onRecordStop={stopRecording}
										onUseRecording={handleUseRecording}
										recordError={recordError}
										recordedBytes={recordedBytes}
										recordedUrl={recordedUrl}
										recordingSeconds={recordingSeconds}
									/>
								) : (
									<UploadPanel
										disabled={isSubmitting}
										durationSeconds={durationSeconds}
										fieldError={fieldError}
										fileName={fileName}
										onFileChange={handleFileChange}
									/>
								)}

								<SubmissionStatus failure={failure} stage={stage} />
							</form>
						</CardPanel>
					</Card>
					<CardFrameFooter className="border-t py-3">
						<div className="inline-flex items-center gap-2">
							<Button render={<Link to="/" />} variant="ghost">
								Cancel
							</Button>
							<Button
								disabled={controlsDisabled}
								form="audio-upload-form"
								loading={isSubmitting}
								type="submit"
							>
								{submitLabel}
							</Button>
						</div>
					</CardFrameFooter>
				</CardFrame>
			</section>
		</main>
	);
}
