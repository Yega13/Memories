// Minimal local types for the Cloudflare R2 binding. The full type lives in
// `@cloudflare/workers-types`, but adding that whole package as a dep just to
// pick up `R2Bucket` is overkill — these two methods are all we touch.

export type R2HttpMetadata = {
  contentType?: string
  contentLanguage?: string
  contentDisposition?: string
  contentEncoding?: string
  cacheControl?: string
  cacheExpiry?: Date
}

export type R2PutOptions = {
  httpMetadata?: R2HttpMetadata
  customMetadata?: Record<string, string>
}

export type R2BucketLike = {
  put(
    key: string,
    value: ArrayBuffer | ArrayBufferView | ReadableStream | Blob | string | null,
    options?: R2PutOptions,
  ): Promise<unknown>
  delete(keys: string | string[]): Promise<void>
}

export type R2Env = {
  R2_VIDEOS?: R2BucketLike
  R2_PUBLIC_HOST?: string
}
