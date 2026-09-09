import { Separator } from "@notetaker-app/ui/components/separator";
import { Link } from "@tanstack/react-router";

import { ModeToggle } from "./mode-toggle";

export default function Header() {
	return (
		<div>
			<div className="flex flex-row items-center justify-between px-2 py-1">
				<nav className="flex items-center gap-4 text-lg">
					<Link to="/">Home</Link>
					<Link to="/meetings/new">New meeting</Link>
				</nav>
				<div className="flex items-center gap-2">
					<ModeToggle />
				</div>
			</div>
			<Separator />
		</div>
	);
}
