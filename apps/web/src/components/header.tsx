import { Separator } from "@notetaker-app/ui/components/separator";
import { Link } from "@tanstack/react-router";

import { ModeToggle } from "./mode-toggle";

const NAV_LINK_CLASS =
	"text-muted-foreground text-sm transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2";

export default function Header() {
	return (
		<div>
			<div className="flex h-16 flex-row items-center justify-between px-4">
				<nav className="flex items-center gap-4">
					<Link
						activeOptions={{ exact: true }}
						activeProps={{ className: "font-medium text-foreground" }}
						className={NAV_LINK_CLASS}
						to="/"
					>
						Home
					</Link>
					<Link
						activeProps={{ className: "font-medium text-foreground" }}
						className={NAV_LINK_CLASS}
						to="/meetings/new"
					>
						New meeting
					</Link>
				</nav>
				<div className="flex items-center gap-2">
					<ModeToggle />
				</div>
			</div>
			<Separator />
		</div>
	);
}
