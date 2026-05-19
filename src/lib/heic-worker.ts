/// <reference lib="webworker" />
// Runs heic2any off the main thread so a slow / hung HEIC conversion can't freeze the UI.
// The main thread posts { id, blob } and gets back { id, jpeg } on success or { id, error } on
// failure. heic2any internally uses libheif-js (WASM); without this worker, that WASM runs
// synchronously on the main thread and makes the page unresponsive for several seconds per file.

type Job = { id: number; blob: Blob }
type Result = { id: number; jpeg?: Blob; error?: string }

self.addEventListener('message', async (e: MessageEvent<Job>) => {
  const { id, blob } = e.data
  try {
    const { default: heic2any } = await import('heic2any')
    const converted = await heic2any({ blob, toType: 'image/jpeg', quality: 0.9 })
    const jpeg = Array.isArray(converted) ? converted[0] : converted
    const reply: Result = { id, jpeg }
    ;(self as unknown as Worker).postMessage(reply)
  } catch (err) {
    const reply: Result = { id, error: err instanceof Error ? err.message : String(err) }
    ;(self as unknown as Worker).postMessage(reply)
  }
})

export {}
