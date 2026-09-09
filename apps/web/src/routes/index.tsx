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
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
	ChevronRightIcon,
	CircleAlertIcon,
	InboxIcon,
	PlusIcon,
	RotateCcwIcon,
} from "lucide-react";
import { useCallback, useMemo } from "react";
import {
	fetchMeetings,
	formatDate,
	formatDuration,
	type PublicMeeting,
} from "@/lib/meetings";

export const Route = createFileRoute("/")({
	component: MeetingsLibrary,
});

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
	const meetingsQuery = useQuery({
		gcTime: 5 * 60 * 1000,
		placeholderData: keepPreviousData,
		queryFn: ({ signal }: { signal: AbortSignal }) => fetchMeetings(signal),
		queryKey: ["meetings"],
		refetchOnWindowFocus: true,
		staleTime: 30 * 1000,
	});
	const meetings = useMemo(
		() => (meetingsQuery.data ? sortNewestFirst(meetingsQuery.data) : null),
		[meetingsQuery.data]
	);
	const hasData = meetings !== null;
	const isFirstLoad = meetingsQuery.isPending && !hasData;
	const isError = meetingsQuery.isError && !hasData;
	const isEmpty = hasData && (meetings?.length ?? 0) === 0;
	const hasMeetings = hasData && (meetings?.length ?? 0) > 0;
	const errorMessage =
		meetingsQuery.error instanceof Error
			? meetingsQuery.error.message
			: "Could not load meetings. Please try again.";

	const handleRetry = useCallback((): void => {
		meetingsQuery.refetch().catch(() => undefined);
	}, [meetingsQuery]);

	return (
		<main className="container mx-auto w-full max-w-3xl px-4 py-6">
			<section aria-labelledby="meetings-title" className="flex flex-col gap-4">
				<CardFrame>
					<CardFrameHeader>
						<CardFrameTitle id="meetings-title" className="text-lg">
							Meetings
						</CardFrameTitle>
						<CardFrameDescription>
							Review recordings, transcripts, and notes.
						</CardFrameDescription>
						{hasMeetings ? (
							<CardFrameAction>
								<Button render={<Link to="/meetings/new" />} size="sm">
									<PlusIcon aria-hidden="true" />
									New meeting
								</Button>
							</CardFrameAction>
						) : null}
					</CardFrameHeader>
					{hasMeetings ? (
						<CardFrameFooter className="border-t py-3">
							<p className="text-xs">
								{meetings?.length ?? 0}{" "}
								{(meetings?.length ?? 0) === 1 ? "meeting" : "meetings"} ·
								Sorted newest first.
							</p>
						</CardFrameFooter>
					) : null}
				</CardFrame>

				{isFirstLoad ? (
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

				{isError ? (
					<Alert variant="error">
						<CircleAlertIcon />
						<AlertTitle>Could not load meetings</AlertTitle>
						<AlertDescription>{errorMessage}</AlertDescription>
						<AlertAction>
							<Button onClick={handleRetry} size="sm" variant="outline">
								Retry
							</Button>
						</AlertAction>
					</Alert>
				) : null}

				{isEmpty ? (
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

				{hasMeetings ? (
					<ul className="flex list-none flex-col gap-3 p-0">
						{(meetings ?? []).map((meeting) => (
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
											<div className="flex w-full min-w-0 items-center justify-between gap-2">
												<div className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
													<span className="min-w-0 truncate">
														{formatDate(meeting.occurredAt)} ·{" "}
														{formatDuration(meeting.durationSeconds)}
													</span>
													<MeetingStatusBadge status={meeting.status} />
												</div>
												<ChevronRightIcon
													aria-hidden="true"
													className="size-4 shrink-0"
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
