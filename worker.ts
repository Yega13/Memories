import { default as handler } from './.open-next/worker.js'

type Env = {
  ALBUM_RETIREMENT_SECRET?: string
}

type ScheduledControllerLike = {
  cron: string
  scheduledTime: number
  type: 'scheduled'
}

type ExecutionContextLike = {
  waitUntil(promise: Promise<unknown>): void
}

type OpenNextHandler = {
  fetch(request: Request, env: Env, ctx: ExecutionContextLike): Promise<Response> | Response
}

const ALBUM_RETIREMENT_CRON = '17 3 * * *'
const INTERNAL_ORIGIN = 'https://hushare.space'

async function runAlbumRetirement(env: Env, ctx: ExecutionContextLike) {
  const headers = new Headers()
  if (env.ALBUM_RETIREMENT_SECRET) {
    headers.set('authorization', `Bearer ${env.ALBUM_RETIREMENT_SECRET}`)
  }

  const request = new Request(`${INTERNAL_ORIGIN}/api/cron/retire-albums`, {
    method: 'POST',
    headers,
  })
  const response = await (handler as OpenNextHandler).fetch(request, env, ctx)
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`Album retirement cron failed with ${response.status}: ${body}`)
  }
}

const worker = {
  fetch: (handler as OpenNextHandler).fetch,

  async scheduled(controller: ScheduledControllerLike, env: Env, ctx: ExecutionContextLike) {
    if (controller.cron === ALBUM_RETIREMENT_CRON) {
      ctx.waitUntil(runAlbumRetirement(env, ctx))
    }
  },
}

export default worker
