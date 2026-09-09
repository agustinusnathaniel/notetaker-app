import { Spinner } from "@notetaker-app/ui/components/spinner";

export default function Loader() {
	return (
		<div className="flex h-full items-center justify-center pt-8">
			<Spinner />
		</div>
	);
}
