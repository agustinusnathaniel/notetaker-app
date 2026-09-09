import {
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	uuid,
} from "drizzle-orm/pg-core";

export interface TranscriptSegment {
	end: number;
	speaker: number | null;
	start: number;
	text: string;
}

export interface ActionItem {
	completed: boolean;
	id: string;
	owner: string | null;
	text: string;
}

export type MeetingSource = "upload" | "recording" | "demo";

export type MeetingStatus =
	| "draft"
	| "uploading"
	| "transcribing"
	| "summarizing"
	| "completed"
	| "failed";

export type FailedStage = "upload" | "transcription" | "summary";

export const meetings = pgTable("meetings", {
	actionItems: jsonb("actionItems").$type<ActionItem[]>().default([]).notNull(),
	audioBytes: integer("audioBytes"),
	audioKey: text("audioKey"),
	audioMimeType: text("audioMimeType"),
	createdAt: timestamp("createdAt", { withTimezone: true })
		.defaultNow()
		.notNull(),
	description: text("description"),
	durationSeconds: integer("durationSeconds").default(0).notNull(),
	failedStage: text("failedStage").$type<FailedStage>(),
	id: uuid("id").primaryKey().defaultRandom(),
	occurredAt: timestamp("occurredAt", { withTimezone: true })
		.defaultNow()
		.notNull(),
	source: text("source").$type<MeetingSource>().notNull(),
	status: text("status").$type<MeetingStatus>().notNull().default("draft"),
	summary: text("summary"),
	takeaways: jsonb("takeaways").$type<string[]>().default([]).notNull(),
	title: text("title").notNull(),
	transcript: text("transcript"),
	transcriptSegments: jsonb("transcriptSegments")
		.$type<TranscriptSegment[]>()
		.default([])
		.notNull(),
	updatedAt: timestamp("updatedAt", { withTimezone: true })
		.defaultNow()
		.notNull(),
});

export type Meeting = typeof meetings.$inferSelect;
export type NewMeeting = typeof meetings.$inferInsert;
