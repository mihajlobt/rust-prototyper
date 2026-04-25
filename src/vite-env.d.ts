/// <reference types="vite/client" />

// Intl.Segmenter augmentation for modern browsers (not in ES2020 typings)
declare namespace Intl {
  interface SegmentData {
    segment: string
    index: number
    input: string
    isWordLike?: boolean
  }
  interface Segments {
    [Symbol.iterator](): IterableIterator<SegmentData>
    containing(index: number): SegmentData
  }
  interface SegmenterOptions {
    granularity?: "grapheme" | "word" | "sentence"
    localeMatcher?: "lookup" | "best fit"
  }
  class Segmenter {
    constructor(locales?: string | string[], options?: SegmenterOptions)
    segment(input: string): Segments
    static supportedLocalesOf(locales: string | string[], options?: SegmenterOptions): string[]
  }
}
