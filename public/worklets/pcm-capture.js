/*
 * Dictation capture worklet. Runs off the main thread, converts the mic's
 * Float32 samples (the AudioContext runs at 16 kHz) to 16-bit little-endian
 * PCM for Deepgram, and posts two kinds of message:
 *   { type: "level", rms }        once per render quantum, for the level meter
 *   { type: "audio", buffer }     2048-sample (128 ms) Int16 frames, transferred
 * Silence is streamed too, so the Deepgram socket never idles out.
 */
class PcmCapture extends AudioWorkletProcessor {
	constructor() {
		super();
		this.frame = new Int16Array(2048);
		this.filled = 0;
	}

	process(inputs) {
		const channel = inputs[0] && inputs[0][0];
		if (!channel) return true;

		let sum = 0;
		for (let i = 0; i < channel.length; i++) sum += channel[i] * channel[i];
		this.port.postMessage({ type: "level", rms: Math.sqrt(sum / channel.length) });

		for (let i = 0; i < channel.length; i++) {
			const s = Math.max(-1, Math.min(1, channel[i]));
			this.frame[this.filled++] = s < 0 ? s * 0x8000 : s * 0x7fff;
			if (this.filled === this.frame.length) {
				this.port.postMessage({ type: "audio", buffer: this.frame.buffer }, [this.frame.buffer]);
				this.frame = new Int16Array(2048);
				this.filled = 0;
			}
		}
		return true;
	}
}

registerProcessor("pcm-capture", PcmCapture);
