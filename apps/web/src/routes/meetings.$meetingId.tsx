import { env } from "@notetaker-app/env/web";
import {
	Alert,
	AlertAction,
	AlertDescription,
	AlertTitle,
} from "@notetaker-app/ui/components/alert";
import { Badge } from "@notetaker-app/ui/components/badge";
import { Button } from "@notetaker-app/ui/components/button";
import {
	Card,
	CardFrame,
	CardFrameAction,
	CardFrameDescription,
	CardFrameFooter,
	CardFrameHeader,
	CardFrameTitle,
	CardPanel,
} from "@notetaker-app/ui/components/card";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@notetaker-app/ui/components/empty";
import {
	Progress,
	ProgressIndicator,
	ProgressLabel,
	ProgressTrack,
	ProgressValue,
} from "@notetaker-app/ui/components/progress";
import { Separator } from "@notetaker-app/ui/components/separator";
import { Skeleton } from "@notetaker-app/ui/components/skeleton";
import {
	Tabs,
	TabsList,
	TabsPanel,
	TabsTab,
} from "@notetaker-app/ui/components/tabs";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
	ChevronLeftIcon,
	CircleAlertIcon,
	FileTextIcon,
	ListChecksIcon,
	ListTodoIcon,
	PlusIcon,
	ScrollTextIcon,
	SearchXIcon,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
	audioUrlFor,
	fetchMeeting,
	formatDate,
	formatDuration,
	isNotFoundError,
	type PublicMeeting,
	requestSummary,
	requestTranscription,
} from "@/lib/meetings";

export const Route = createFileRoute("/meetings/$meetingId")({
	component: MeetingDetail,
});

type DetailState =
	| { status: "loading" }
	| { status: "not-found" }
	| { status: "error"; message: string }
	| { status: "ready"; meeting: PublicMeeting };

const PROCESSING_STATUSES: ReadonlySet<PublicMeeting["status"]> = new Set([
	"draft",
	"uploading",
	"transcribing",
	"summarizing",
]);

const PROCESSING_PROGRESS: Record<string, number> = {
	draft: 15,
	summarizing: 90,
	transcribing: 70,
	uploading: 40,
};

function MeetingStatusBadge({
	status,
	label,
}: {
	readonly label?: string;
	readonly status: PublicMeeting["status"];
}): React.ReactElement {
	let dotClassName = "bg-amber-500";
	let variant: "outline" | "success" | "error" = "outline";
	if (status === "completed") {
		dotClassName = "bg-emerald-500";
		variant = "success";
	} else if (status === "failed") {
		dotClassName = "bg-red-500";
		variant = "error";
	}
	return (
		<Badge variant={variant}>
			<span
				aria-hidden="true"
				className={`size-1.5 rounded-full ${dotClassName}`}
			/>
			{label ?? status}
		</Badge>
	);
}

const FAILED_STAGE_LABELS: Record<string, string> = {
	summary: "summary",
	transcription: "transcription",
	upload: "upload",
};

type RetryStage = "idle" | "transcribing" | "summarizing";

interface FailedMeetingViewProps {
	readonly meeting: PublicMeeting;
	readonly onReload: () => void;
	readonly onRetrySummary: () => void;
	readonly onRetryTranscription: () => void;
	readonly retryError: string | null;
	readonly retryStage: RetryStage;
}

function FailedMeetingView(props: FailedMeetingViewProps): React.ReactElement {
	const {
		meeting,
		onReload,
		onRetrySummary,
		onRetryTranscription,
		retryError,
		retryStage,
	} = props;
	const stageLabel =
		(meeting.failedStage && FAILED_STAGE_LABELS[meeting.failedStage]) ??
		"processing";
	const canRetryTranscription =
		meeting.failedStage === "transcription" && meeting.audioAvailable;
	const canRetrySummary =
		meeting.failedStage === "summary" &&
		typeof meeting.transcript === "string" &&
		meeting.transcript.trim().length > 0;
	const isRetrying = retryStage !== "idle";
	const describedBy = retryError ? "meeting-retry-error" : undefined;
	let alertRetryButton: React.ReactElement;
	if (canRetryTranscription) {
		alertRetryButton = (
			<Button
				aria-describedby={describedBy}
				disabled={isRetrying}
				loading={retryStage === "transcribing"}
				onClick={onRetryTranscription}
				size="xs"
				variant="outline"
			>
				Retry
			</Button>
		);
	} else if (canRetrySummary) {
		alertRetryButton = (
			<Button
				aria-describedby={describedBy}
				disabled={isRetrying}
				loading={retryStage === "summarizing"}
				onClick={onRetrySummary}
				size="xs"
				variant="outline"
			>
				Retry
			</Button>
		);
	} else {
		alertRetryButton = (
			<Button
				disabled={isRetrying}
				onClick={onReload}
				size="xs"
				variant="outline"
			>
				Retry
			</Button>
		);
	}
	return (
		<main className="container mx-auto w-full max-w-3xl px-4 py-6">
			<section aria-labelledby="meeting-title" className="flex flex-col gap-4">
				<CardFrame>
					<CardFrameHeader>
						{/* biome-ignore lint/a11y/useHeadingContent: CardFrameTitle renders an h1 with the meeting title as content. */}
						<CardFrameTitle id="meeting-title" render={<h1 />}>
							{meeting.title}
						</CardFrameTitle>
						<CardFrameDescription>
							{formatDate(meeting.occurredAt)} ·{" "}
							{formatDuration(meeting.durationSeconds)}
						</CardFrameDescription>
						<CardFrameAction>
							<MeetingStatusBadge
								label={`Failed during ${stageLabel}`}
								status="failed"
							/>
						</CardFrameAction>
					</CardFrameHeader>
					<Card>
						<CardPanel>
							<div className="flex flex-col gap-3">
								<p className="text-sm">
									Processing failed during {stageLabel}.{" "}
									{canRetryTranscription || canRetrySummary
										? "You can retry this step below."
										: "Upload a new file from the new-meeting flow to try again."}
								</p>
								{isRetrying ? (
									<p aria-live="polite" className="text-sm" role="status">
										{retryStage === "transcribing"
											? "Retrying transcription…"
											: "Retrying summary…"}
									</p>
								) : null}
								{retryError ? (
									<Alert id="meeting-retry-error" variant="error">
										<CircleAlertIcon />
										<AlertTitle>Retry failed</AlertTitle>
										<AlertDescription>{retryError}</AlertDescription>
										<AlertAction>{alertRetryButton}</AlertAction>
									</Alert>
								) : null}
							</div>
						</CardPanel>
					</Card>
					<CardFrameFooter className="border-t py-3">
						<div className="flex flex-wrap items-center gap-2">
							{canRetryTranscription ? (
								<Button
									aria-describedby={describedBy}
									disabled={isRetrying}
									loading={retryStage === "transcribing"}
									onClick={onRetryTranscription}
								>
									Retry transcription
								</Button>
							) : null}
							{canRetrySummary ? (
								<Button
									aria-describedby={describedBy}
									disabled={isRetrying}
									loading={retryStage === "summarizing"}
									onClick={onRetrySummary}
								>
									Retry summary
								</Button>
							) : null}
							<Button
								disabled={isRetrying}
								onClick={onReload}
								variant="outline"
							>
								Reload
							</Button>
							<Button render={<Link to="/" />} variant="link">
								<ChevronLeftIcon aria-hidden="true" />
								Back Home
							</Button>
						</div>
					</CardFrameFooter>
				</CardFrame>
			</section>
		</main>
	);
}

function MeetingDetail(): React.ReactElement {
	const { meetingId } = Route.useParams();
	const [state, setState] = useState<DetailState>({ status: "loading" });
	const [retryStage, setRetryStage] = useState<RetryStage>("idle");
	const [retryError, setRetryError] = useState<string | null>(null);

	const load = useCallback(
		(signal?: AbortSignal) => {
			setState({ status: "loading" });
			fetchMeeting(meetingId, signal)
				.then((loaded) => {
					if (!signal?.aborted) {
						setState({ status: "ready", meeting: loaded });
					}
				})
				.catch((error: unknown) => {
					if (signal?.aborted) {
						return;
					}
					if (isNotFoundError(error)) {
						setState({ status: "not-found" });
						return;
					}
					setState({
						status: "error",
						message:
							error instanceof Error
								? error.message
								: "Could not load this meeting. Please try again.",
					});
				});
		},
		[meetingId]
	);

	useEffect(() => {
		const controller = new AbortController();
		load(controller.signal);
		return () => {
			controller.abort();
		};
	}, [load]);

	const handleRetry = useCallback(() => {
		setRetryError(null);
		setRetryStage("idle");
		load();
	}, [load]);

	const handleRetryTranscription = useCallback(async (): Promise<void> => {
		setRetryStage("transcribing");
		setRetryError(null);
		try {
			const updated = await requestTranscription(meetingId);
			setRetryStage("idle");
			setState({ status: "ready", meeting: updated });
		} catch (error: unknown) {
			setRetryStage("idle");
			setRetryError(
				error instanceof Error
					? error.message
					: "Transcription retry failed. Please try again."
			);
		}
	}, [meetingId]);

	const handleRetrySummary = useCallback(async (): Promise<void> => {
		setRetryStage("summarizing");
		setRetryError(null);
		try {
			const updated = await requestSummary(meetingId);
			setRetryStage("idle");
			setState({ status: "ready", meeting: updated });
		} catch (error: unknown) {
			setRetryStage("idle");
			setRetryError(
				error instanceof Error
					? error.message
					: "Summary retry failed. Please try again."
			);
		}
	}, [meetingId]);

	const handleRetryTranscriptionClick = useCallback((): void => {
		handleRetryTranscription().catch(() => undefined);
	}, [handleRetryTranscription]);

	const handleRetrySummaryClick = useCallback((): void => {
		handleRetrySummary().catch(() => undefined);
	}, [handleRetrySummary]);

	if (state.status === "loading") {
		return (
			<main className="container mx-auto w-full max-w-3xl px-4 py-6">
				<div
					aria-label="Loading meeting"
					className="flex flex-col gap-3"
					role="status"
				>
					<CardFrame>
						<Card>
							<CardPanel className="flex flex-col gap-3">
								<Skeleton className="h-6 w-2/3 rounded-md" />
								<Skeleton className="h-4 w-1/3 rounded-md" />
								<Skeleton className="h-24 w-full rounded-xl" />
								<Skeleton className="h-32 w-full rounded-xl" />
							</CardPanel>
						</Card>
					</CardFrame>
				</div>
			</main>
		);
	}

	if (state.status === "not-found") {
		return (
			<main className="container mx-auto w-full max-w-3xl px-4 py-6">
				<Empty>
					<EmptyHeader>
						<EmptyMedia variant="icon">
							<SearchXIcon />
						</EmptyMedia>
						<EmptyTitle>Meeting not found</EmptyTitle>
						<EmptyDescription>
							This meeting does not exist or the link is invalid.
						</EmptyDescription>
					</EmptyHeader>
					<EmptyContent>
						<div className="flex gap-2">
							<Button render={<Link to="/" />} size="sm">
								Back Home
							</Button>
							<Button
								render={<Link to="/meetings/new" />}
								size="sm"
								variant="outline"
							>
								<PlusIcon aria-hidden="true" />
								New meeting
							</Button>
						</div>
					</EmptyContent>
				</Empty>
			</main>
		);
	}

	if (state.status === "error") {
		return (
			<main className="container mx-auto w-full max-w-3xl px-4 py-6">
				<Alert variant="error">
					<CircleAlertIcon />
					<AlertTitle>Could not load this meeting</AlertTitle>
					<AlertDescription>{state.message}</AlertDescription>
					<AlertAction>
						<div className="flex gap-2">
							<Button
								onClick={handleRetry}
								size="sm"
								type="button"
								variant="outline"
							>
								Retry
							</Button>
							<Button render={<Link to="/" />} size="sm" variant="link">
								<ChevronLeftIcon aria-hidden="true" />
								Back Home
							</Button>
						</div>
					</AlertAction>
				</Alert>
			</main>
		);
	}

	const { meeting } = state;

	if (meeting.status === "failed") {
		return (
			<FailedMeetingView
				meeting={meeting}
				onReload={handleRetry}
				onRetrySummary={handleRetrySummaryClick}
				onRetryTranscription={handleRetryTranscriptionClick}
				retryError={retryError}
				retryStage={retryStage}
			/>
		);
	}

	if (PROCESSING_STATUSES.has(meeting.status)) {
		const progressValue = PROCESSING_PROGRESS[meeting.status] ?? 15;
		return (
			<main className="container mx-auto w-full max-w-3xl px-4 py-6">
				<section
					aria-labelledby="meeting-title"
					className="flex flex-col gap-4"
				>
					<CardFrame>
						<CardFrameHeader>
							{/* biome-ignore lint/a11y/useHeadingContent: CardFrameTitle renders an h1 with the meeting title as content. */}
							<CardFrameTitle id="meeting-title" render={<h1 />}>
								{meeting.title}
							</CardFrameTitle>
							<CardFrameDescription>
								{formatDate(meeting.occurredAt)} ·{" "}
								{formatDuration(meeting.durationSeconds)}
							</CardFrameDescription>
							<CardFrameAction>
								<MeetingStatusBadge status={meeting.status} />
							</CardFrameAction>
						</CardFrameHeader>
						<Card>
							<CardPanel>
								<div className="flex flex-col gap-3">
									<Progress value={progressValue}>
										<div className="flex items-center justify-between gap-2">
											<ProgressLabel>Processing {meeting.status}</ProgressLabel>
											<ProgressValue />
										</div>
										<ProgressTrack>
											<ProgressIndicator />
										</ProgressTrack>
									</Progress>
									<p className="text-sm" role="status">
										This meeting is still being processed. Check back shortly
										for the transcript and summary.
									</p>
								</div>
							</CardPanel>
						</Card>
						<CardFrameFooter className="border-t py-3">
							<div className="flex w-full flex-wrap items-center justify-between gap-2">
								<p className="text-muted-foreground text-xs">
									Processing runs automatically. Reload to check for updates.
								</p>
								<Button render={<Link to="/" />} size="sm" variant="link">
									<ChevronLeftIcon aria-hidden="true" />
									Back Home
								</Button>
							</div>
						</CardFrameFooter>
					</CardFrame>
				</section>
			</main>
		);
	}

	const audioUrl = audioUrlFor(env.VITE_SERVER_URL, meeting.id);

	return (
		<main className="container mx-auto w-full max-w-3xl px-4 py-6">
			<section aria-labelledby="meeting-title" className="flex flex-col gap-4">
				<CardFrame>
					<CardFrameHeader>
						{/* biome-ignore lint/a11y/useHeadingContent: CardFrameTitle renders an h1 with the meeting title as content. */}
						<CardFrameTitle id="meeting-title" render={<h1 />}>
							{meeting.title}
						</CardFrameTitle>
						<CardFrameDescription>
							{formatDate(meeting.occurredAt)} ·{" "}
							{formatDuration(meeting.durationSeconds)}
						</CardFrameDescription>
						<CardFrameAction>
							<MeetingStatusBadge status={meeting.status} />
						</CardFrameAction>
					</CardFrameHeader>
					<CardFrameFooter className="border-t py-3">
						<p className="text-muted-foreground text-xs">
							Audio, transcript, and notes are kept together on this page.
						</p>
					</CardFrameFooter>
				</CardFrame>

				{meeting.description ? (
					<section aria-labelledby="meeting-description-heading">
						<h2
							className="mb-1 font-medium text-sm"
							id="meeting-description-heading"
						>
							Description
						</h2>
						<p className="text-sm">{meeting.description}</p>
					</section>
				) : null}

				{meeting.audioAvailable ? (
					<section aria-labelledby="meeting-audio-heading">
						<h2 className="mb-1 font-medium text-sm" id="meeting-audio-heading">
							Audio
						</h2>
						{/* biome-ignore lint/a11y/useMediaCaption: the transcript section below is the text alternative for this recording. */}
						<audio controls preload="metadata" src={audioUrl}>
							Your browser does not support audio playback.
						</audio>
					</section>
				) : null}

				<Separator className="my-4" />

				<Tabs defaultValue="transcript">
					<div className="border-b">
						<TabsList variant="underline">
							<TabsTab value="transcript">
								<FileTextIcon aria-hidden="true" />
								Transcript
							</TabsTab>
							<TabsTab value="summary">
								<ScrollTextIcon aria-hidden="true" />
								Summary
							</TabsTab>
							<TabsTab value="takeaways">
								<ListChecksIcon aria-hidden="true" />
								Takeaways
								<Badge
									className="not-in-data-active:text-muted-foreground"
									variant="outline"
								>
									{meeting.takeaways.length}
								</Badge>
							</TabsTab>
							<TabsTab value="actions">
								<ListTodoIcon aria-hidden="true" />
								Actions
								<Badge
									className="not-in-data-active:text-muted-foreground"
									variant="outline"
								>
									{meeting.actionItems.length}
								</Badge>
							</TabsTab>
						</TabsList>
					</div>
					<TabsPanel value="transcript">
						<section
							aria-labelledby="meeting-transcript-heading"
							className="pt-2"
						>
							<CardFrame>
								<CardFrameHeader>
									<CardFrameTitle
										id="meeting-transcript-heading"
										// biome-ignore lint/a11y/useHeadingContent: CardFrameTitle renders an h2 with the transcript title as content.
										render={<h2 />}
									>
										Transcript
									</CardFrameTitle>
								</CardFrameHeader>
								<Card>
									<CardPanel>
										<p className="whitespace-pre-wrap text-sm leading-relaxed">
											{meeting.transcript ?? "No transcript is available yet."}
										</p>
									</CardPanel>
								</Card>
								<CardFrameFooter className="border-t py-3">
									<div className="flex gap-1 text-muted-foreground text-xs">
										<CircleAlertIcon
											aria-hidden="true"
											className="size-3 h-lh shrink-0"
										/>
										<p>
											The audio recording above is the source of truth for this
											transcript.
										</p>
									</div>
								</CardFrameFooter>
							</CardFrame>
						</section>
					</TabsPanel>
					<TabsPanel value="summary">
						<section aria-labelledby="meeting-summary-heading" className="pt-2">
							<CardFrame>
								<CardFrameHeader>
									{/* biome-ignore lint/a11y/useHeadingContent: CardFrameTitle renders an h2 with the summary title as content. */}
									<CardFrameTitle id="meeting-summary-heading" render={<h2 />}>
										Summary
									</CardFrameTitle>
								</CardFrameHeader>
								<Card>
									<CardPanel>
										<p className="whitespace-pre-wrap text-sm leading-relaxed">
											{meeting.summary ?? "No summary is available yet."}
										</p>
									</CardPanel>
								</Card>
								<CardFrameFooter className="border-t py-3">
									<div className="flex gap-1 text-muted-foreground text-xs">
										<CircleAlertIcon
											aria-hidden="true"
											className="size-3 h-lh shrink-0"
										/>
										<p>
											Generated from the transcript. Verify key details against
											the audio.
										</p>
									</div>
								</CardFrameFooter>
							</CardFrame>
						</section>
					</TabsPanel>
					<TabsPanel value="takeaways">
						<section
							aria-labelledby="meeting-takeaways-heading"
							className="pt-2"
						>
							<CardFrame>
								<CardFrameHeader>
									<CardFrameTitle
										id="meeting-takeaways-heading"
										// biome-ignore lint/a11y/useHeadingContent: CardFrameTitle renders an h2 with the takeaways title as content.
										render={<h2 />}
									>
										Key takeaways
									</CardFrameTitle>
									<CardFrameAction>
										<Badge variant="outline">{meeting.takeaways.length}</Badge>
									</CardFrameAction>
								</CardFrameHeader>
								<Card>
									<CardPanel>
										{meeting.takeaways.length > 0 ? (
											<ul className="list-disc space-y-1 pl-5 text-sm">
												{meeting.takeaways.map((takeaway, index) => (
													<li key={`${String(index)}-${takeaway}`}>
														{takeaway}
													</li>
												))}
											</ul>
										) : (
											<p className="text-muted-foreground text-sm">
												No takeaways were recorded.
											</p>
										)}
									</CardPanel>
								</Card>
								<CardFrameFooter className="border-t py-3">
									<div className="flex gap-1 text-muted-foreground text-xs">
										<CircleAlertIcon
											aria-hidden="true"
											className="size-3 h-lh shrink-0"
										/>
										<p>Review each takeaway before sharing.</p>
									</div>
								</CardFrameFooter>
							</CardFrame>
						</section>
					</TabsPanel>
					<TabsPanel value="actions">
						<section aria-labelledby="meeting-actions-heading" className="pt-2">
							<CardFrame>
								<CardFrameHeader>
									{/* biome-ignore lint/a11y/useHeadingContent: CardFrameTitle renders an h2 with the action items title as content. */}
									<CardFrameTitle id="meeting-actions-heading" render={<h2 />}>
										Action items
									</CardFrameTitle>
									<CardFrameAction>
										<Badge variant="outline">
											{meeting.actionItems.length}
										</Badge>
									</CardFrameAction>
								</CardFrameHeader>
								<Card>
									<CardPanel>
										{meeting.actionItems.length > 0 ? (
											<ul className="list-disc space-y-1 pl-5 text-sm">
												{meeting.actionItems.map((item, index) => (
													<li
														key={`${String(index)}-${item.owner ?? "unassigned"}-${item.text}`}
													>
														{item.text}
														{item.owner ? ` (owner: ${item.owner})` : null}
													</li>
												))}
											</ul>
										) : (
											<p className="text-muted-foreground text-sm">
												No action items were recorded.
											</p>
										)}
									</CardPanel>
								</Card>
								<CardFrameFooter className="border-t py-3">
									<div className="flex gap-1 text-muted-foreground text-xs">
										<CircleAlertIcon
											aria-hidden="true"
											className="size-3 h-lh shrink-0"
										/>
										<p>Assign an owner before marking an item complete.</p>
									</div>
								</CardFrameFooter>
							</CardFrame>
						</section>
					</TabsPanel>
				</Tabs>

				<div>
					<Button render={<Link to="/" />} variant="link">
						<ChevronLeftIcon aria-hidden="true" />
						Back Home
					</Button>
				</div>
			</section>
		</main>
	);
}
