/**
 * AudioWorklet processor for microphone capture.
 * Accumulates 128-sample quantum chunks into 4096-sample buffers
 * before posting to the main thread, matching the old ScriptProcessorNode
 * buffer size (~85ms at 48kHz).
 */
const BUFFER_SIZE = 4096;

class AudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buffer = new Float32Array(BUFFER_SIZE);
    this._writePos = 0;
  }

  process(inputs) {
    const channel = inputs[0]?.[0];
    if (!channel) return true;

    for (let i = 0; i < channel.length; i++) {
      this._buffer[this._writePos++] = channel[i];
      if (this._writePos === BUFFER_SIZE) {
        const chunk = this._buffer.slice();
        this.port.postMessage(chunk, [chunk.buffer]);
        this._buffer = new Float32Array(BUFFER_SIZE);
        this._writePos = 0;
      }
    }

    return true; // keep processor alive
  }
}

registerProcessor('audio-processor', AudioProcessor);