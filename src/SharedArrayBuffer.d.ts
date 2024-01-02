// Adds definitions missing from TypeScript, this feature is available since Node.js 20

interface SharedArrayBufferOptions {
  maxByteLength?: number
}

interface SharedArrayBufferConstructor {
  readonly prototype: SharedArrayBuffer
  new (
    byteLength: number,
    options?: SharedArrayBufferOptions,
  ): SharedArrayBuffer
}

/**
 * https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer/grow#specifications
 */
interface SharedArrayBuffer {
  /**
   * returns whether this SharedArrayBuffer can be grow or not.
   */
  readonly growable?: boolean

  /**
   * returns the maximum length (in bytes) that this SharedArrayBuffer can be grown to.
   */
  readonly maxByteLength?: number

  /**
   * grows the SharedArrayBuffer to the specified size, in bytes.
   */
  grow?(newLength: number): void
}
