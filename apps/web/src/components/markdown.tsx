import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

function MarkdownLink({
	href,
	children,
}: {
	readonly children?: ReactNode;
	readonly href?: string;
}): React.ReactElement {
	return (
		<a
			className="underline underline-offset-4"
			href={href}
			rel="noopener"
			target="_blank"
		>
			{children}
		</a>
	);
}

export function MeetingMarkdown({
	text,
}: {
	readonly text: string;
}): React.ReactElement {
	return (
		<div className="space-y-2 text-sm leading-relaxed">
			<ReactMarkdown
				components={{
					a: MarkdownLink,
					h1: ({ children }) => (
						<h3 className="font-semibold text-base">{children}</h3>
					),
					h2: ({ children }) => (
						<h3 className="font-semibold text-base">{children}</h3>
					),
					h3: ({ children }) => (
						<h4 className="font-medium text-sm">{children}</h4>
					),
					h4: ({ children }) => (
						<h4 className="font-medium text-sm">{children}</h4>
					),
					li: ({ children }) => <li className="leading-relaxed">{children}</li>,
					ol: ({ children }) => (
						<ol className="list-decimal space-y-1 pl-5">{children}</ol>
					),
					p: ({ children }) => (
						<p className="whitespace-pre-wrap leading-relaxed">{children}</p>
					),
					ul: ({ children }) => (
						<ul className="list-disc space-y-1 pl-5">{children}</ul>
					),
				}}
				remarkPlugins={[remarkGfm]}
			>
				{text}
			</ReactMarkdown>
		</div>
	);
}
