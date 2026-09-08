import { useChat } from "@ai-sdk/react";
import { env } from "@notetaker-app/env/web";
import { Bubble, BubbleContent } from "@notetaker-app/ui/components/bubble";
import { Button } from "@notetaker-app/ui/components/button";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@notetaker-app/ui/components/empty";
import { Input } from "@notetaker-app/ui/components/input";
import {
	InputGroup,
	InputGroupAddon,
	InputGroupButton,
	InputGroupTextarea,
} from "@notetaker-app/ui/components/input-group";
import {
	Message,
	MessageContent as MessageBody,
	MessageHeader,
} from "@notetaker-app/ui/components/message";
import {
	MessageScroller,
	MessageScrollerButton,
	MessageScrollerContent,
	MessageScrollerItem,
	MessageScrollerProvider,
	MessageScrollerViewport,
} from "@notetaker-app/ui/components/message-scroller";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@notetaker-app/ui/components/tooltip";
import { createFileRoute } from "@tanstack/react-router";
import { DefaultChatTransport } from "ai";
import {
	ArrowUpIcon,
	Loader2,
	MessageCircleDashedIcon,
	RotateCwIcon,
} from "lucide-react";
import {
	type ChangeEvent,
	type FormEvent,
	type KeyboardEvent,
	useCallback,
	useState,
} from "react";
import { Streamdown } from "streamdown";

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
			className="flex flex-col gap-3 rounded-lg border bg-card p-4"
		>
			<div className="flex flex-col gap-1">
				<h2 className="font-medium text-sm" id="transcription-title">
					Transcribe an audio file
				</h2>
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
					<h3 className="font-medium text-sm">Transcript</h3>
					<output aria-live="polite" className="text-sm leading-relaxed">
						{state.text || "No speech was recognized."}
					</output>
				</div>
			)}
		</section>
	);
}

export const Route = createFileRoute("/ai")({
	component: RouteComponent,
});

function RouteComponent() {
	const [input, setInput] = useState("");
	const { messages, sendMessage, status, setMessages } = useChat({
		transport: new DefaultChatTransport({
			api: `${env.VITE_SERVER_URL}/ai`,
		}),
	});
	const isSending = status === "submitted" || status === "streaming";

	const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
		e.preventDefault();
		const text = input.trim();
		if (!text || isSending) {
			return;
		}
		sendMessage({ text });
		setInput("");
	};

	const handlePromptKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			e.currentTarget.form?.requestSubmit();
		}
	};

	const resetConversation = () => {
		setInput("");
		setMessages([]);
	};

	return (
		<MessageScrollerProvider>
			<div className="flex h-full min-h-0 w-full flex-col">
				<header className="shrink-0 border-b px-4 py-3">
					<div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3">
						<div className="min-w-0">
							<h1 className="font-medium text-sm">New Chat</h1>
							<p className="text-muted-foreground text-xs/relaxed">
								How can I help you today?
							</p>
						</div>
						<div className="shrink-0">
							<Tooltip>
								<TooltipTrigger
									render={
										<Button
											aria-label="Reset conversation"
											disabled={isSending}
											onClick={resetConversation}
											size="icon-sm"
											type="button"
											variant="outline"
										/>
									}
								>
									<RotateCwIcon />
								</TooltipTrigger>
								<TooltipContent>Reset</TooltipContent>
							</Tooltip>
						</div>
					</div>
				</header>
				<main className="min-h-0 flex-1">
					{messages.length === 0 && !isSending ? (
						<Empty className="mx-auto h-full max-w-3xl px-4">
							<EmptyHeader>
								<EmptyMedia variant="icon">
									<MessageCircleDashedIcon />
								</EmptyMedia>
								<EmptyTitle>Morning, notetaker-app!</EmptyTitle>
								<EmptyDescription>
									What are we working on today?
								</EmptyDescription>
							</EmptyHeader>
						</Empty>
					) : (
						<MessageScroller>
							<MessageScrollerViewport>
								<MessageScrollerContent
									aria-busy={isSending}
									className="mx-auto w-full max-w-3xl px-4 py-6"
								>
									{messages.map((message) => {
										const isUser = message.role === "user";

										return (
											<MessageScrollerItem
												key={message.id}
												scrollAnchor={isUser}
											>
												<Message align={isUser ? "end" : "start"}>
													<MessageBody>
														<MessageHeader>
															{isUser ? "You" : "AI Assistant"}
														</MessageHeader>
														<Bubble
															align={isUser ? "end" : "start"}
															variant={isUser ? "default" : "secondary"}
														>
															<BubbleContent>
																{message.parts?.map((part, index) => {
																	if (part.type === "text") {
																		return (
																			<Streamdown
																				isAnimating={
																					status === "streaming" &&
																					message.role === "assistant"
																				}
																				key={index}
																			>
																				{part.text}
																			</Streamdown>
																		);
																	}
																	return null;
																})}
															</BubbleContent>
														</Bubble>
													</MessageBody>
												</Message>
											</MessageScrollerItem>
										);
									})}
									{status === "submitted" && (
										<MessageScrollerItem>
											<Message align="start">
												<MessageBody>
													<Bubble variant="secondary">
														<BubbleContent className="flex items-center gap-2">
															<Loader2 className="size-3.5 animate-spin" />
															<span className="shimmer">Thinking...</span>
														</BubbleContent>
													</Bubble>
												</MessageBody>
											</Message>
										</MessageScrollerItem>
									)}
									<MessageScrollerItem scrollAnchor />
								</MessageScrollerContent>
							</MessageScrollerViewport>
							<MessageScrollerButton />
						</MessageScroller>
					)}
				</main>
				<footer className="shrink-0 border-t px-4 py-3">
					<div className="mx-auto flex w-full max-w-3xl flex-col gap-2">
						<TranscriptionPanel />
						<form className="w-full" onSubmit={handleSubmit}>
							<InputGroup>
								<InputGroupTextarea
									autoComplete="off"
									autoFocus
									className="max-h-32 min-h-14"
									disabled={isSending}
									name="prompt"
									onChange={(e) => setInput(e.target.value)}
									onKeyDown={handlePromptKeyDown}
									placeholder="Type your message..."
									rows={1}
									value={input}
								/>
								<InputGroupAddon align="block-end" className="pt-1">
									<InputGroupButton
										className="ml-auto"
										disabled={isSending || !input.trim()}
										size="icon-sm"
										type="submit"
										variant="default"
									>
										{isSending ? (
											<Loader2 className="animate-spin" />
										) : (
											<ArrowUpIcon />
										)}
										<span className="sr-only">Send</span>
									</InputGroupButton>
								</InputGroupAddon>
							</InputGroup>
						</form>
					</div>
				</footer>
			</div>
		</MessageScrollerProvider>
	);
}
