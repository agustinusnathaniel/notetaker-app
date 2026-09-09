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
	CardDescription,
	CardFrame,
	CardFrameAction,
	CardFrameDescription,
	CardFrameFooter,
	CardFrameHeader,
	CardFrameTitle,
	CardHeader,
	CardPanel,
	CardTitle,
} from "@notetaker-app/ui/components/card";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@notetaker-app/ui/components/empty";
import { Skeleton } from "@notetaker-app/ui/components/skeleton";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
	ChevronRightIcon,
	CircleAlertIcon,
	InboxIcon,
	PlusIcon,
	RotateCcwIcon,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
	fetchMeetings,
	formatDate,
	formatDuration,
	type PublicMeeting,
} from "@/lib/meetings";

export const Route = createFileRoute("/")({
	component: MeetingsLibrary,
});

type LibraryState =
	| { status: "loading" }
	| { status: "error"; message: string }
	| { status: "ready"; meetings: PublicMeeting[] };

function sortNewestFirst(meetings: PublicMeeting[]): PublicMeeting[] {
	return [...meetings].sort(
		(a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)
	);
}

function MeetingStatusBadge({
	status,
}: {
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
			{status}
		</Badge>
	);
}

function MeetingsLibrary(): React.ReactElement {
	const [state, setState] = useState<LibraryState>({ status: "loading" });

	const load = useCallback((signal?: AbortSignal) => {
		setState({ status: "loading" });
		fetchMeetings(signal)
			.then((meetings) => {
				if (!signal?.aborted) {
					setState({ status: "ready", meetings: sortNewestFirst(meetings) });
				}
			})
			.catch((error: unknown) => {
				if (signal?.aborted) {
					return;
				}
				setState({
					status: "error",
					message:
						error instanceof Error
							? error.message
							: "Could not load meetings. Please try again.",
				});
			});
	}, []);

	useEffect(() => {
		const controller = new AbortController();
		load(controller.signal);
		return () => {
			controller.abort();
		};
	}, [load]);

	const handleRetry = useCallback(() => {
		load();
	}, [load]);

	return (
		<main className="container mx-auto w-full max-w-3xl px-4 py-6">
			<section aria-labelledby="meetings-title" className="flex flex-col gap-4">
				<CardFrame>
					<CardFrameHeader>
						{/* biome-ignore lint/a11y/useHeadingContent: CardFrameTitle renders an h1 with the library title as content. */}
						<CardFrameTitle id="meetings-title" render={<h1 />}>
							Meetings
						</CardFrameTitle>
						<CardFrameDescription>
							Review recordings, transcripts, and notes.
						</CardFrameDescription>
						{state.status === "ready" && state.meetings.length > 0 ? (
							<CardFrameAction>
								<Button render={<Link to="/meetings/new" />} size="sm">
									<PlusIcon aria-hidden="true" />
									New meeting
								</Button>
							</CardFrameAction>
						) : null}
					</CardFrameHeader>
					{state.status === "ready" && state.meetings.length > 0 ? (
						<CardFrameFooter className="border-t py-3">
							<p className="text-muted-foreground text-xs">
								{state.meetings.length}{" "}
								{state.meetings.length === 1 ? "meeting" : "meetings"} · Sorted
								newest first.
							</p>
						</CardFrameFooter>
					) : null}
				</CardFrame>

				{state.status === "loading" ? (
					<div
						aria-label="Loading meetings"
						className="flex flex-col gap-3"
						role="status"
					>
						<CardFrame>
							<Card>
								<CardPanel className="flex flex-col gap-3">
									<Skeleton className="h-5 w-1/3 rounded-md" />
									<Skeleton className="h-16 w-full rounded-xl" />
									<Skeleton className="h-4 w-2/3 rounded-md" />
								</CardPanel>
							</Card>
						</CardFrame>
						<CardFrame>
							<Card>
								<CardPanel className="flex flex-col gap-3">
									<Skeleton className="h-5 w-1/4 rounded-md" />
									<Skeleton className="h-16 w-full rounded-xl" />
									<Skeleton className="h-4 w-1/2 rounded-md" />
								</CardPanel>
							</Card>
						</CardFrame>
					</div>
				) : null}

				{state.status === "error" ? (
					<Alert variant="error">
						<CircleAlertIcon />
						<AlertTitle>Could not load meetings</AlertTitle>
						<AlertDescription>{state.message}</AlertDescription>
						<AlertAction>
							<Button onClick={handleRetry} size="sm" variant="outline">
								Retry
							</Button>
						</AlertAction>
					</Alert>
				) : null}

				{state.status === "ready" && state.meetings.length === 0 ? (
					<Empty>
						<EmptyHeader>
							<EmptyMedia variant="icon">
								<InboxIcon />
							</EmptyMedia>
							<EmptyTitle>No meetings yet</EmptyTitle>
							<EmptyDescription>
								Create your first meeting to upload audio and generate notes.
							</EmptyDescription>
						</EmptyHeader>
						<EmptyContent>
							<div className="flex gap-2">
								<Button render={<Link to="/meetings/new" />} size="sm">
									New meeting
								</Button>
								<Button onClick={handleRetry} size="sm" variant="outline">
									<RotateCcwIcon aria-hidden="true" />
									Reload
								</Button>
							</div>
						</EmptyContent>
					</Empty>
				) : null}

				{state.status === "ready" && state.meetings.length > 0 ? (
					<ul className="flex list-none flex-col gap-3 p-0">
						{state.meetings.map((meeting) => (
							<li key={meeting.id}>
								<Link
									className="block rounded-2xl focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
									params={{ meetingId: meeting.id }}
									to="/meetings/$meetingId"
								>
									<CardFrame>
										<Card>
											<CardHeader>
												{/* biome-ignore lint/a11y/useHeadingContent: CardTitle renders an h2 with the meeting title as content. */}
												<CardTitle render={<h2 />}>{meeting.title}</CardTitle>
												{meeting.description ? (
													<CardDescription>
														{meeting.description}
													</CardDescription>
												) : null}
											</CardHeader>
										</Card>
										<CardFrameFooter className="border-t py-3">
											<div className="flex w-full items-center justify-between gap-2">
												<div className="flex flex-wrap items-center gap-2 text-muted-foreground text-sm">
													<span>
														{formatDate(meeting.occurredAt)} ·{" "}
														{formatDuration(meeting.durationSeconds)}
													</span>
													<MeetingStatusBadge status={meeting.status} />
												</div>
												<ChevronRightIcon
													aria-hidden="true"
													className="size-4 shrink-0 text-muted-foreground"
												/>
											</div>
										</CardFrameFooter>
									</CardFrame>
								</Link>
							</li>
						))}
					</ul>
				) : null}
			</section>
		</main>
	);
}
