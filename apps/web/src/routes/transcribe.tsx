import { env } from "@notetaker-app/env/web";
import { Button } from "@notetaker-app/ui/components/button";
import { Input } from "@notetaker-app/ui/components/input";
import { createFileRoute } from "@tanstack/react-router";
import { type ChangeEvent, type FormEvent, useCallback, useState } from "react";

const MAX_AUDIO_BYTES = 4 * 1024 * 1024;
const AUDIO_FILE_ERROR_ID = "audio-file-error";
const AUDIO_MIME_TYPES: Record<string, string> = {
	".aac": "audio/aac",
	".flac": "audio/flac",
	".m4a": "audio/mp4",
	".mp3": "audio/mpeg",
	".oga": "audio/ogg",
	".ogg": "audio/ogg",
	".opus": "audio/ogg",
	".wav": "audio/wav",
	".webm": "audio/webm",
};
const FILE_VALIDATION_ERROR_CODES = new Set([
	"audio_too_large",
	"empty_audio",
	"unsupported_media_type",
]);
const GENERIC_TRANSCRIPTION_ERROR = "Transcription failed. Please try again.";

type TranscriptionState =
	| { status: "idle" }
	| { status: "submitting" }
	| { status: "success"; text: string }
	| { message: string; status: "file-error" }
	| { status: "error"; message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function getApiError(body: unknown): { code: string; message: string } | null {
	if (!(isRecord(body) && isRecord(body.error))) {
		return null;
	}

	const { code, message } = body.error;
	if (typeof code !== "string" || typeof message !== "string") {
		return null;
	}

	return { code, message };
}

function isTranscriptionResponse(body: unknown): body is { text: string } {
	return isRecord(body) && typeof body.text === "string";
}

function resolveAudioMimeType(file: File): string | null {
	const declaredType = file.type.trim().toLowerCase();
	if (declaredType) {
		return declaredType.startsWith("audio/") ? declaredType : null;
	}

	const extensionStart = file.name.lastIndexOf(".");
	const extension =
		extensionStart === -1 ? "" : file.name.slice(extensionStart).toLowerCase();
	return AUDIO_MIME_TYPES[extension] ?? null;
}

function getFileValidationMessage(file: File): string {
	if (file.type.trim()) {
		return "Choose a file with an audio/* MIME type.";
	}

	return "Could not identify this audio file. Use a supported extension such as .mp3, .wav, .m4a, .ogg, .flac, or .webm.";
}

function TranscriptionPanel() {
	const [file, setFile] = useState<File | null>(null);
	const [state, setState] = useState<TranscriptionState>({ status: "idle" });
	const isSubmitting = state.status === "submitting";
	const fileValidationError =
		state.status === "file-error" ? state.message : undefined;

	const handleFileChange = useCallback(
		(event: ChangeEvent<HTMLInputElement>) => {
			const nextFile = event.target.files?.[0] ?? null;
			setFile(nextFile);
			setState({ status: "idle" });
		},
		[]
	);

	const handleSubmit = useCallback(
		async (event: FormEvent<HTMLFormElement>) => {
			event.preventDefault();

			if (!file || isSubmitting) {
				return;
			}

			const contentType = resolveAudioMimeType(file);
			if (!contentType) {
				setState({
					message: getFileValidationMessage(file),
					status: "file-error",
				});
				return;
			}

			if (file.size > MAX_AUDIO_BYTES) {
				setState({
					status: "file-error",
					message: "Audio files must be 4 MiB or smaller.",
				});
				return;
			}

			setState({ status: "submitting" });

			try {
				const response = await fetch(`${env.VITE_SERVER_URL}/transcribe`, {
					method: "POST",
					headers: { "Content-Type": contentType },
					body: file,
				});
				const body: unknown = await response.json();

				if (!response.ok) {
					const apiError = getApiError(body);
					if (apiError && FILE_VALIDATION_ERROR_CODES.has(apiError.code)) {
						setState({ message: apiError.message, status: "file-error" });
					} else {
						setState({ message: GENERIC_TRANSCRIPTION_ERROR, status: "error" });
					}
					return;
				}

				if (!isTranscriptionResponse(body)) {
					throw new Error(
						"The transcription service returned an invalid response."
					);
				}

				setState({ status: "success", text: body.text });
			} catch {
				setState({
					status: "error",
					message: GENERIC_TRANSCRIPTION_ERROR,
				});
			}
		},
		[file, isSubmitting]
	);

	return (
		<section
			aria-labelledby="transcription-title"
			className="mx-auto flex w-full max-w-3xl flex-col gap-3 rounded-lg border bg-card p-4"
		>
			<div className="flex flex-col gap-1">
				<h1 className="font-medium text-lg" id="transcription-title">
					Transcribe an audio file
				</h1>
				<p className="text-muted-foreground text-xs/relaxed">
					Whisper converts an audio upload into text. Audio files up to 4 MiB
					are supported.
				</p>
			</div>
			<form
				className="flex flex-col gap-3 sm:flex-row sm:items-end"
				onSubmit={handleSubmit}
			>
				<div className="flex min-w-0 flex-1 flex-col gap-1.5">
					<label className="font-medium text-sm" htmlFor="audio-file">
						Audio file
					</label>
					<Input
						accept="audio/*"
						aria-describedby={
							fileValidationError ? AUDIO_FILE_ERROR_ID : undefined
						}
						aria-invalid={fileValidationError ? true : undefined}
						disabled={isSubmitting}
						id="audio-file"
						name="audio-file"
						onChange={handleFileChange}
						type="file"
					/>
				</div>
				<Button disabled={!file} loading={isSubmitting} type="submit">
					Transcribe audio
				</Button>
			</form>
			{(state.status === "file-error" || state.status === "error") && (
				<p
					className="text-destructive text-sm"
					id={state.status === "file-error" ? AUDIO_FILE_ERROR_ID : undefined}
					role="alert"
				>
					{state.message}
				</p>
			)}
			{state.status === "success" && (
				<div className="flex flex-col gap-1 rounded-md border bg-muted/30 p-3">
					<h2 className="font-medium text-sm">Transcript</h2>
					<output aria-live="polite" className="text-sm leading-relaxed">
						{state.text || "No speech was recognized."}
					</output>
				</div>
			)}
		</section>
	);
}

export const Route = createFileRoute("/transcribe")({
	component: TranscriptionPanel,
});
