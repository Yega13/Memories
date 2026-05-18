
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

export type R2UploadPart = {
  partNumber: number
  etag: string
}

export type R2MultipartUpload = {
  uploadId: string
  uploadPart(
    partNumber: number,
    value: ArrayBuffer | ArrayBufferView | ReadableStream | Blob | string | null,
  ): Promise<R2UploadPart>
  complete(uploadedParts: R2UploadPart[]): Promise<unknown>
  abort(): Promise<void>
}

export type R2BucketLike = {
  put(
    key: string,
    value: ArrayBuffer | ArrayBufferView | ReadableStream | Blob | string | null,
    options?: R2PutOptions,
  ): Promise<unknown>
  delete(keys: string | string[]): Promise<void>
  createMultipartUpload(key: string, options?: R2PutOptions): Promise<R2MultipartUpload>
  resumeMultipartUpload(key: string, uploadId: string): R2MultipartUpload
}

export type R2Env = {
  R2_VIDEOS?: R2BucketLike
  R2_PUBLIC_HOST?: string
}
