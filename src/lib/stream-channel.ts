/**
 * StreamChannel — bridges push-based chunk sources (Tauri Channel IPC)
 * into an AsyncIterable<string> that useTextStream can consume with mode="fade".
 *
 * Usage:
 *   const channel = new StreamChannel()
 *   // Push chunks from Tauri Channel onmessage:
 *   channel.push("Hello ")
 *   channel.push("world!")
 *   channel.close()
 *   // ... pass channel to useTextStream({ textStream: channel, mode: "fade" })
 */

export class StreamChannel implements AsyncIterable<string> {
  private chunks: string[] = []
  private waiting: ((value: IteratorResult<string>) => void) | null = null
  private done = false
  private error: unknown = null

  /** Push a new text chunk into the stream. */
  push(chunk: string): void {
    if (this.done) return
    if (this.waiting) {
      const resolve = this.waiting
      this.waiting = null
      resolve({ value: chunk, done: false })
    } else {
      this.chunks.push(chunk)
    }
  }

  /** Signal that the stream has ended. */
  close(): void {
    this.done = true
    if (this.waiting) {
      const resolve = this.waiting
      this.waiting = null
      resolve({ value: undefined, done: true })
    }
  }

  /** Signal an error — the consumer will throw on next iteration. */
  abort(error: unknown): void {
    this.error = error
    this.done = true
    if (this.waiting) {
      const resolve = this.waiting
      this.waiting = null
      resolve({ value: undefined, done: true })
    }
  }

  /** AsyncIterable interface — useTextStream consumes this. */
  [Symbol.asyncIterator](): AsyncIterableIterator<string> {
    // Bind methods to this instance to avoid `this` aliasing lint error
    const chunks = this.chunks
    const getDone = () => this.done
    const getError = () => this.error
    const setDone = (v: boolean) => { this.done = v }
    const setError = (e: unknown) => { this.error = e }
    const setWaiting = (w: ((value: IteratorResult<string>) => void) | null) => { this.waiting = w }

    const iterator: AsyncIterableIterator<string> = {
      async next(): Promise<IteratorResult<string>> {
        const err = getError()
        if (err) throw err
        if (chunks.length > 0) {
          return { value: chunks.shift()!, done: false }
        }
        if (getDone()) {
          return { value: undefined, done: true }
        }
        // No chunks available — wait for a push
        return new Promise<IteratorResult<string>>((resolve) => {
          setWaiting(resolve)
        })
      },
      return(): Promise<IteratorResult<string>> {
        setDone(true)
        return Promise.resolve({ value: undefined, done: true })
      },
      throw(e?: unknown): Promise<IteratorResult<string>> {
        setError(e)
        setDone(true)
        return Promise.resolve({ value: undefined, done: true })
      },
      [Symbol.asyncIterator]() {
        return iterator
      },
    }
    return iterator
  }
}