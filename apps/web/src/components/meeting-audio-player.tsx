import {
	AudioPlayer,
	AudioPlayerControlBar,
	AudioPlayerDurationDisplay,
	AudioPlayerElement,
	AudioPlayerMuteButton,
	AudioPlayerPlayButton,
	AudioPlayerSeekBackwardButton,
	AudioPlayerSeekForwardButton,
	AudioPlayerTimeDisplay,
	AudioPlayerTimeRange,
	AudioPlayerVolumeRange,
} from "@notetaker-app/ui/components/ai-elements/audio-player";

export function MeetingAudioPlayer({
	src,
	label = "Meeting audio",
}: {
	readonly label?: string;
	readonly src: string;
}): React.ReactElement {
	return (
		<AudioPlayer className="w-full max-w-full">
			<AudioPlayerElement aria-label={label} preload="metadata" src={src} />
			<AudioPlayerControlBar className="w-full max-w-full flex-wrap">
				<AudioPlayerPlayButton aria-label="Play or pause meeting audio" />
				<AudioPlayerSeekBackwardButton aria-label="Back 10 seconds" />
				<AudioPlayerSeekForwardButton aria-label="Forward 10 seconds" />
				<AudioPlayerTimeRange aria-label="Seek" className="min-w-24 flex-1" />
				<AudioPlayerTimeDisplay />
				<AudioPlayerDurationDisplay />
				<AudioPlayerMuteButton aria-label="Mute or unmute" />
				<AudioPlayerVolumeRange
					aria-label="Volume"
					className="hidden sm:flex"
				/>
			</AudioPlayerControlBar>
		</AudioPlayer>
	);
}

export function MeetingAudioPreview({
	src,
}: {
	readonly src: string;
}): React.ReactElement {
	return <MeetingAudioPlayer label="Recorded audio preview" src={src} />;
}
