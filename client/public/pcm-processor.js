/**
 * PCMProcessor - AudioWorkletProcessor for real-time 16kHz linear Int16 PCM audio streaming.
 * Clamps audio between -1.0 and 1.0, batches into 2048 samples (~128ms at 16kHz),
 * and transfers raw ArrayBuffer to main thread via this.port.
 */
class PCMProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.bufferSize = 2048;
    this.buffer = new Float32Array(this.bufferSize);
    this.bufferIndex = 0;
    this.flushed = false;

    // Optional sanity check: notify main thread if sample rate does not match 16kHz
    if (sampleRate !== 16000) {
      this.port.postMessage({
        type: "WARN_SAMPLE_RATE",
        actualSampleRate: sampleRate,
      });
    }

    // Listen for manual flush when recording stops to prevent clipping tail audio
    this.port.onmessage = (event) => {
      if (event.data === "flush" || event.data?.action === "flush") {
        this.flushed = true;
        this.flushRemaining();
        this.port.postMessage({ type: "FLUSH_COMPLETE" });
      }
    };
  }

  flushRemaining() {
    if (this.bufferIndex === 0) return;

    const remainingSamples = this.bufferIndex;
    const int16Buffer = new Int16Array(remainingSamples);

    for (let j = 0; j < remainingSamples; j++) {
      const sample = Math.max(-1.0, Math.min(1.0, this.buffer[j]));
      int16Buffer[j] = Math.round(sample < 0 ? sample * 0x8000 : sample * 0x7fff);
    }

    this.port.postMessage(int16Buffer.buffer, [int16Buffer.buffer]);
    this.bufferIndex = 0;
  }

  process(inputs) {
    if (this.flushed) return false;
    const input = inputs[0];
    if (!input || input.length === 0) {
      return true;
    }

    const channelData = input[0];
    if (!channelData) {
      return true;
    }

    for (let i = 0; i < channelData.length; i++) {
      this.buffer[this.bufferIndex++] = channelData[i];

      // Once we collect 2048 samples, convert to linear Int16 PCM
      if (this.bufferIndex >= this.bufferSize) {
        const int16Buffer = new Int16Array(this.bufferSize);

        for (let j = 0; j < this.bufferSize; j++) {
          const sample = Math.max(-1.0, Math.min(1.0, this.buffer[j]));
          int16Buffer[j] = Math.round(sample < 0 ? sample * 0x8000 : sample * 0x7fff);
        }

        // Zero-copy transfer of the ArrayBuffer
        this.port.postMessage(int16Buffer.buffer, [int16Buffer.buffer]);

        // Zero-allocation reset: reuse the existing Float32Array buffer
        this.bufferIndex = 0;
      }
    }

    return true;
  }
}

registerProcessor("pcm-processor", PCMProcessor);
