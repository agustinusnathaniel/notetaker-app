import { env } from "@notetaker-app/env/web";
import {
	Alert,
	AlertAction,
	AlertDescription,
	AlertTitle,
} from "@notetaker-app/ui/components/alert";
import {
	AlertDialog,
	AlertDialogClose,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogPopup,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "@notetaker-app/ui/components/alert-dialog";
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
import { Checkbox } from "@notetaker-app/ui/components/checkbox";
import {
	Dialog,
	DialogClose,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogPanel,
	DialogPopup,
	DialogTitle,
	DialogTrigger,
} from "@notetaker-app/ui/components/dialog";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@notetaker-app/ui/components/empty";
import {
	Field,
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
import { Separator } from "@notetaker-app/ui/components/separator";
import { Skeleton } from "@notetaker-app/ui/components/skeleton";
import {
	Tabs,
	TabsList,
	TabsPanel,
	TabsTab,
} from "@notetaker-app/ui/components/tabs";
import { Textarea } from "@notetaker-app/ui/components/textarea";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
	ChevronLeftIcon,
	CircleAlertIcon,
	FileTextIcon,
	ListChecksIcon,
	ListTodoIcon,
	PencilIcon,
	PlusIcon,
	ScrollTextIcon,
	SearchXIcon,
	Trash2Icon,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { MeetingMarkdown } from "@/components/markdown";
import {
	type ActionItem,
	audioUrlFor,
	deleteMeeting,
	fetchMeeting,
	formatDate,
	formatDuration,
	isNotFoundError,
	type PublicMeeting,
	requestSummary,
	requestTranscription,
	updateMeeting,
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

function EditMeetingDialog({
	meeting,
	onUpdated,
}: {
	readonly meeting: PublicMeeting;
	readonly onUpdated: (updated: PublicMeeting) => void;
}): React.ReactElement {
	const [open, setOpen] = useState<boolean>(false);
	const [title, setTitle] = useState<string>(meeting.title);
	const [description, setDescription] = useState<string>(
		meeting.description ?? ""
	);
	const [fieldError, setFieldError] = useState<string | null>(null);
	const [saving, setSaving] = useState<boolean>(false);

	const handleOpenChange = useCallback(
		(next: boolean) => {
			setOpen(next);
			if (next) {
				setTitle(meeting.title);
				setDescription(meeting.description ?? "");
				setFieldError(null);
				setSaving(false);
			}
		},
		[meeting]
	);

	const handleTitleChange = useCallback(
		(event: React.ChangeEvent<HTMLInputElement>): void => {
			setTitle(event.target.value);
		},
		[]
	);

	const handleDescriptionChange = useCallback(
		(event: React.ChangeEvent<HTMLTextAreaElement>): void => {
			setDescription(event.target.value);
		},
		[]
	);

	const handleSubmit = useCallback(
		(event: React.FormEvent<HTMLFormElement>): void => {
			event.preventDefault();
			const nextTitle = title.trim();
			if (!nextTitle) {
				setFieldError("Title is required.");
				return;
			}
			if (nextTitle.length > 100) {
				setFieldError("Title must be 100 characters or fewer.");
				return;
			}
			const trimmedDescription = description.trim();
			if (trimmedDescription.length > 200) {
				setFieldError("Description must be 200 characters or fewer.");
				return;
			}
			setFieldError(null);
			setSaving(true);
			updateMeeting(meeting.id, {
				description: trimmedDescription ? trimmedDescription : null,
				title: nextTitle,
			})
				.then((updated) => {
					setSaving(false);
					setOpen(false);
					onUpdated(updated);
				})
				.catch((error: unknown) => {
					setSaving(false);
					setFieldError(
						error instanceof Error
							? error.message
							: "Could not save changes. Please try again."
					);
				});
		},
		[description, meeting.id, onUpdated, title]
	);

	return (
		<Dialog onOpenChange={handleOpenChange} open={open}>
			<DialogTrigger
				render={
					<Button size="sm" variant="outline">
						<PencilIcon aria-hidden="true" />
						Edit
					</Button>
				}
			/>
			<DialogPopup>
				<DialogHeader>
					<DialogTitle>Edit meeting</DialogTitle>
					<DialogDescription>
						Update the title and description for this meeting.
					</DialogDescription>
				</DialogHeader>
				<form className="contents" onSubmit={handleSubmit}>
					<DialogPanel>
						<div className="flex flex-col gap-4">
							<Field invalid={!!fieldError}>
								<FieldLabel htmlFor="meeting-title-input">Title</FieldLabel>
								<Input
									disabled={saving}
									id="meeting-title-input"
									maxLength={100}
									onChange={handleTitleChange}
									value={title}
								/>
							</Field>
							<Field>
								<FieldLabel htmlFor="meeting-description-input">
									Description
								</FieldLabel>
								<Textarea
									disabled={saving}
									id="meeting-description-input"
									maxLength={200}
									onChange={handleDescriptionChange}
									rows={3}
									value={description}
								/>
							</Field>
							{fieldError ? (
								<FieldError match={true}>{fieldError}</FieldError>
							) : null}
						</div>
					</DialogPanel>
					<DialogFooter>
						<DialogClose
							render={
								<Button type="button" variant="ghost">
									Cancel
								</Button>
							}
						/>
						<Button disabled={saving} loading={saving} type="submit">
							Save changes
						</Button>
					</DialogFooter>
				</form>
			</DialogPopup>
		</Dialog>
	);
}

function DeleteMeetingDialog({
	meetingId,
}: {
	readonly meetingId: string;
}): React.ReactElement {
	const navigate = useNavigate();
	const [error, setError] = useState<string | null>(null);
	const [deleting, setDeleting] = useState<boolean>(false);

	const handleConfirm = useCallback((): void => {
		setError(null);
		setDeleting(true);
		deleteMeeting(meetingId)
			.then(() => {
				navigate({ to: "/" }).catch(() => undefined);
			})
			.catch((failure: unknown) => {
				setDeleting(false);
				setError(
					failure instanceof Error
						? failure.message
						: "Could not delete this meeting. Please try again."
				);
			});
	}, [meetingId, navigate]);

	return (
		<AlertDialog>
			<AlertDialogTrigger
				render={
					<Button size="sm" variant="destructive-outline">
						<Trash2Icon aria-hidden="true" />
						Delete
					</Button>
				}
			/>
			<AlertDialogPopup>
				<AlertDialogHeader>
					<AlertDialogTitle>Delete this meeting?</AlertDialogTitle>
					<AlertDialogDescription>
						This removes the meeting, its audio, transcript, and notes. This
						action cannot be undone.
					</AlertDialogDescription>
				</AlertDialogHeader>
				{error ? (
					<div className="px-6">
						<Alert variant="error">
							<CircleAlertIcon />
							<AlertTitle>Delete failed</AlertTitle>
							<AlertDescription>{error}</AlertDescription>
						</Alert>
					</div>
				) : null}
				<AlertDialogFooter>
					<AlertDialogClose
						render={
							<Button type="button" variant="ghost">
								Cancel
							</Button>
						}
					/>
					<Button
						disabled={deleting}
						loading={deleting}
						onClick={handleConfirm}
						type="button"
						variant="destructive"
					>
						Delete meeting
					</Button>
				</AlertDialogFooter>
			</AlertDialogPopup>
		</AlertDialog>
	);
}

function ActionItemsList({
	disabled,
	items,
	onToggle,
	togglingId,
}: {
	readonly disabled: boolean;
	readonly items: ActionItem[];
	readonly onToggle: (id: string, completed: boolean) => void;
	readonly togglingId: string | null;
}): React.ReactElement {
	if (items.length === 0) {
		return (
			<p className="text-muted-foreground text-sm">
				No action items were recorded.
			</p>
		);
	}
	return (
		<ul className="flex list-none flex-col gap-2 p-0">
			{items.map((item) => (
				<li key={item.id}>
					<label className="flex cursor-pointer items-start gap-2.5 text-sm">
						<Checkbox
							checked={item.completed}
							className="mt-0.5"
							disabled={disabled || togglingId === item.id}
							onCheckedChange={(checked: boolean | "indeterminate"): void => {
								onToggle(item.id, checked === true);
							}}
						/>
						<span className="flex flex-col gap-0.5">
							<span
								className={
									item.completed ? "text-muted-foreground line-through" : ""
								}
							>
								{item.text}
							</span>
							{item.owner ? (
								<span className="text-muted-foreground text-xs">
									Owner: {item.owner}
								</span>
							) : null}
						</span>
					</label>
				</li>
			))}
		</ul>
	);
}

function MeetingDetail(): React.ReactElement {
	const { meetingId } = Route.useParams();
	const [state, setState] = useState<DetailState>({ status: "loading" });
	const [retryStage, setRetryStage] = useState<RetryStage>("idle");
	const [retryError, setRetryError] = useState<string | null>(null);
	const [togglingId, setTogglingId] = useState<string | null>(null);
	const [actionError, setActionError] = useState<string | null>(null);

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

	const handleMeetingUpdated = useCallback((updated: PublicMeeting): void => {
		setState({ status: "ready", meeting: updated });
	}, []);

	const handleToggleActionItem = useCallback(
		(id: string, completed: boolean): void => {
			if (state.status !== "ready") {
				return;
			}
			const previous = state.meeting.actionItems;
			const next = previous.map((item) =>
				item.id === id ? { ...item, completed } : item
			);
			setState({
				status: "ready",
				meeting: { ...state.meeting, actionItems: next },
			});
			setTogglingId(id);
			setActionError(null);
			updateMeeting(meetingId, { actionItems: next })
				.then((updated) => {
					setTogglingId(null);
					setState({ status: "ready", meeting: updated });
				})
				.catch((error: unknown) => {
					setTogglingId(null);
					setState({
						status: "ready",
						meeting: { ...state.meeting, actionItems: previous },
					});
					setActionError(
						error instanceof Error
							? error.message
							: "Could not update this action item. Please try again."
					);
				});
		},
		[meetingId, state]
	);

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
							<div className="flex flex-wrap items-center gap-2">
								<MeetingStatusBadge status={meeting.status} />
								<EditMeetingDialog
									meeting={meeting}
									onUpdated={handleMeetingUpdated}
								/>
								<DeleteMeetingDialog meetingId={meeting.id} />
							</div>
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
										{meeting.summary ? (
											<MeetingMarkdown text={meeting.summary} />
										) : (
											<p className="text-sm">No summary is available yet.</p>
										)}
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
											<ul className="flex list-none flex-col gap-3 p-0">
												{meeting.takeaways.map((takeaway, index) => (
													<li key={`${String(index)}-${takeaway.slice(0, 32)}`}>
														<MeetingMarkdown text={takeaway} />
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
										<div className="flex flex-col gap-3">
											{togglingId ? (
												<p
													aria-live="polite"
													className="text-muted-foreground text-xs"
													role="status"
												>
													Saving change…
												</p>
											) : null}
											{actionError ? (
												<Alert variant="error">
													<CircleAlertIcon />
													<AlertTitle>Could not update</AlertTitle>
													<AlertDescription>{actionError}</AlertDescription>
												</Alert>
											) : null}
											<ActionItemsList
												disabled={togglingId !== null}
												items={meeting.actionItems}
												onToggle={handleToggleActionItem}
												togglingId={togglingId}
											/>
										</div>
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
