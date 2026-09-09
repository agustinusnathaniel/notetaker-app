import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { Separator } from "@notetaker-app/ui/components/separator";
import { cn } from "@notetaker-app/ui/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";
import type React from "react";

const buttonGroupVariants = cva(
	"flex w-fit items-stretch *:focus-visible:relative *:focus-visible:z-10 has-[>[data-slot=button-group]]:gap-2",
	{
		defaultVariants: {
			orientation: "horizontal",
		},
		variants: {
			orientation: {
				horizontal:
					"*:data-slot:rounded-r-none [&>[data-slot]:not(:has(~[data-slot]))]:rounded-r-lg! [&>[data-slot]~[data-slot]]:rounded-l-none [&>[data-slot]~[data-slot]]:border-l-0",
				vertical:
					"flex-col *:data-slot:rounded-b-none [&>[data-slot]:not(:has(~[data-slot]))]:rounded-b-lg! [&>[data-slot]~[data-slot]]:rounded-t-none [&>[data-slot]~[data-slot]]:border-t-0",
			},
		},
	}
);

function ButtonGroup({
	className,
	orientation,
	...props
}: React.ComponentProps<"div"> &
	VariantProps<typeof buttonGroupVariants>): React.ReactElement {
	return (
		// biome-ignore lint/a11y/useSemanticElements: ButtonGroup mirrors upstream shadcn markup; a toolbar-style div with role group avoids fieldset and legend semantics for icon control clusters.
		<div
			className={cn(buttonGroupVariants({ orientation }), className)}
			data-orientation={orientation}
			data-slot="button-group"
			role="group"
			{...props}
		/>
	);
}

function ButtonGroupText({
	className,
	render,
	...props
}: useRender.ComponentProps<"div">): React.ReactElement {
	return useRender({
		defaultTagName: "div",
		props: mergeProps<"div">(
			{
				className: cn(
					"flex items-center gap-2 rounded-lg border bg-muted px-2.5 font-medium text-sm [&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none",
					className
				),
			},
			props
		),
		render,
		state: {
			slot: "button-group-text",
		},
	});
}

function ButtonGroupSeparator({
	className,
	orientation = "vertical",
	...props
}: React.ComponentProps<typeof Separator>): React.ReactElement {
	return (
		<Separator
			className={cn(
				"relative self-stretch bg-input data-horizontal:mx-px data-vertical:my-px data-vertical:h-auto data-horizontal:w-auto",
				className
			)}
			data-slot="button-group-separator"
			orientation={orientation}
			{...props}
		/>
	);
}

export {
	ButtonGroup,
	ButtonGroupSeparator,
	ButtonGroupText,
	buttonGroupVariants,
};
