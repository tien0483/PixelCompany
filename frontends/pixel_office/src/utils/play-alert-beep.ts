let sharedAudioContext: AudioContext | null = null;

function getSharedAudioContext(): AudioContext | null {
	if (typeof window === "undefined") {
		return null;
	}
	const AudioContextCtor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
	if (!AudioContextCtor) {
		return null;
	}
	if (!sharedAudioContext) {
		sharedAudioContext = new AudioContextCtor();
	}
	return sharedAudioContext;
}

/** Plays a short synthesized tone to alert the user. No audio asset required. */
export function playAlertBeep(): void {
	const audioContext = getSharedAudioContext();
	if (!audioContext) {
		return;
	}
	if (audioContext.state === "suspended") {
		void audioContext.resume().catch(() => {
			// Ignore resume failures (e.g. no user gesture yet).
		});
	}
	try {
		const oscillator = audioContext.createOscillator();
		const gain = audioContext.createGain();
		oscillator.type = "sine";
		oscillator.frequency.setValueAtTime(800, audioContext.currentTime);
		gain.gain.setValueAtTime(0.15, audioContext.currentTime);
		gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.15);
		oscillator.connect(gain);
		gain.connect(audioContext.destination);
		oscillator.start();
		oscillator.stop(audioContext.currentTime + 0.15);
	} catch {
		// Ignore playback failures.
	}
}
