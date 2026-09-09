import { env } from "@notetaker-app/env/web";
import { Button } from "@notetaker-app/ui/components/button";
import {
	Card,
	CardDescription,
	CardHeader,
	CardPanel,
	CardTitle,
} from "@notetaker-app/ui/components/card";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyTitle,
} from "@notetaker-app/ui/components/empty";
import { Skeleton } from "@notetaker-app/ui/components/skeleton";
import { createFileRoute, Link } from "@tanstack/react-router";
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
	return (
		<main className="container mx-auto w-full max-w-3xl px-4 py-6">
			<section aria-labelledby="meeting-title" className="flex flex-col gap-4">
				<Card>
					<CardHeader>
						{/* biome-ignore lint/a11y/useHeadingContent: CardTitle renders an h1 with the meeting title as content. */}
						<CardTitle render={<h1 />}>{meeting.title}</CardTitle>
						<CardDescription>
							{formatDate(meeting.occurredAt)} ·{" "}
							{formatDuration(meeting.durationSeconds)}
						</CardDescription>
						<p className="mt-1">
							<span className="inline-flex items-center rounded-md border px-2 py-0.5 text-xs">
								Failed during {stageLabel}
							</span>
						</p>
					</CardHeader>
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
								<p
									className="text-destructive text-sm"
									id="meeting-retry-error"
									role="alert"
								>
									{retryError}
								</p>
							) : null}
							<div className="flex flex-wrap gap-2">
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
							</div>
						</div>
					</CardPanel>
				</Card>
				<Button render={<Link to="/" />} variant="outline">
					Back Home
				</Button>
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
					<Skeleton className="h-8 w-2/3" />
					<Skeleton className="h-24 w-full" />
					<Skeleton className="h-40 w-full" />
				</div>
			</main>
		);
	}

	if (state.status === "not-found") {
		return (
			<main className="container mx-auto w-full max-w-3xl px-4 py-6">
				<Empty>
					<EmptyHeader>
						<EmptyTitle>Meeting not found</EmptyTitle>
						<EmptyDescription>
							This meeting does not exist or the link is invalid.
						</EmptyDescription>
					</EmptyHeader>
					<EmptyContent>
						<Button render={<Link to="/" />}>Back Home</Button>
					</EmptyContent>
				</Empty>
			</main>
		);
	}

	if (state.status === "error") {
		return (
			<main className="container mx-auto w-full max-w-3xl px-4 py-6">
				<div className="flex flex-col items-start gap-3 rounded-lg border p-4">
					<p className="text-destructive text-sm" role="alert">
						{state.message}
					</p>
					<div className="flex gap-2">
						<Button onClick={handleRetry} variant="outline">
							Retry
						</Button>
						<Button render={<Link to="/" />} variant="ghost">
							Back Home
						</Button>
					</div>
				</div>
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
		return (
			<main className="container mx-auto w-full max-w-3xl px-4 py-6">
				<section
					aria-labelledby="meeting-title"
					className="flex flex-col gap-4"
				>
					<Card>
						<CardHeader>
							{/* biome-ignore lint/a11y/useHeadingContent: CardTitle renders an h1 with the meeting title as content. */}
							<CardTitle render={<h1 />}>{meeting.title}</CardTitle>
							<CardDescription>
								{formatDate(meeting.occurredAt)} ·{" "}
								{formatDuration(meeting.durationSeconds)}
							</CardDescription>
							<p className="mt-1">
								<span className="inline-flex items-center rounded-md border px-2 py-0.5 text-xs">
									{meeting.status}
								</span>
							</p>
						</CardHeader>
						<CardPanel>
							<p className="text-sm" role="status">
								This meeting is still being processed. Check back shortly for
								the transcript and summary.
							</p>
						</CardPanel>
					</Card>
					<Button render={<Link to="/" />} variant="outline">
						Back Home
					</Button>
				</section>
			</main>
		);
	}

	const audioUrl = audioUrlFor(env.VITE_SERVER_URL, meeting.id);

	return (
		<main className="container mx-auto w-full max-w-3xl px-4 py-6">
			<section aria-labelledby="meeting-title" className="flex flex-col gap-4">
				<Card>
					<CardHeader>
						{/* biome-ignore lint/a11y/useHeadingContent: CardTitle renders an h1 with the meeting title as content. */}
						<CardTitle render={<h1 />}>{meeting.title}</CardTitle>
						<CardDescription>
							{formatDate(meeting.occurredAt)} ·{" "}
							{formatDuration(meeting.durationSeconds)}
						</CardDescription>
						<p className="mt-1">
							<span className="inline-flex items-center rounded-md border px-2 py-0.5 text-xs">
								{meeting.status}
							</span>
						</p>
					</CardHeader>
				</Card>

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

				<section aria-labelledby="meeting-transcript-heading">
					<h2
						className="mb-1 font-medium text-sm"
						id="meeting-transcript-heading"
					>
						Transcript
					</h2>
					<p className="whitespace-pre-wrap text-sm leading-relaxed">
						{meeting.transcript ?? "No transcript is available yet."}
					</p>
				</section>

				<section aria-labelledby="meeting-summary-heading">
					<h2 className="mb-1 font-medium text-sm" id="meeting-summary-heading">
						Summary
					</h2>
					<p className="whitespace-pre-wrap text-sm leading-relaxed">
						{meeting.summary ?? "No summary is available yet."}
					</p>
				</section>

				<section aria-labelledby="meeting-takeaways-heading">
					<h2
						className="mb-1 font-medium text-sm"
						id="meeting-takeaways-heading"
					>
						Key takeaways
					</h2>
					{meeting.takeaways.length > 0 ? (
						<ul className="list-disc space-y-1 pl-5 text-sm">
							{meeting.takeaways.map((takeaway) => (
								<li key={takeaway}>{takeaway}</li>
							))}
						</ul>
					) : (
						<p className="text-muted-foreground text-sm">
							No takeaways were recorded.
						</p>
					)}
				</section>

				<section aria-labelledby="meeting-actions-heading">
					<h2 className="mb-1 font-medium text-sm" id="meeting-actions-heading">
						Action items
					</h2>
					{meeting.actionItems.length > 0 ? (
						<ul className="list-disc space-y-1 pl-5 text-sm">
							{meeting.actionItems.map((item) => (
								<li key={`${item.owner ?? "unassigned"}-${item.text}`}>
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
				</section>

				<div>
					<Button render={<Link to="/" />} variant="outline">
						Back Home
					</Button>
				</div>
			</section>
		</main>
	);
}
