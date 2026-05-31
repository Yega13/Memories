/// <reference lib="webworker" />

import JSZip from 'jszip'

addEventListener('message', async (e: MessageEvent<{
  files: Array<{ name: string; buffer: ArrayBuffer }>
  title: string
}>) => {
  const { files, title } = e.data
  const zip = new JSZip()
  const folder = zip.folder(title) || zip

  for (const { name, buffer } of files) {
    folder.file(name, buffer)
  }

  const blob = await zip.generateAsync(
    { type: 'blob', compression: 'STORE' },
    ({ percent }: { percent: number }) => {
      postMessage({ type: 'progress', percent })
    },
  )

  postMessage({ type: 'complete', blob })
})
