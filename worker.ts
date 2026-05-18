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

const DAILY_CRON = '17 3 * * *'
const INTERNAL_ORIGIN = 'https://hushare.space'

async function callCronRoute(path: string, env: Env, ctx: ExecutionContextLike) {
  const headers = new Headers()
  if (env.ALBUM_RETIREMENT_SECRET) {
    headers.set('authorization', `Bearer ${env.ALBUM_RETIREMENT_SECRET}`)
  }

  const request = new Request(`${INTERNAL_ORIGIN}${path}`, {
    method: 'POST',
    headers,
  })
  const response = await (handler as OpenNextHandler).fetch(request, env, ctx)
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`Cron ${path} failed with ${response.status}: ${body}`)
  }
}

const worker = {
  fetch: (handler as OpenNextHandler).fetch,

  async scheduled(controller: ScheduledControllerLike, env: Env, ctx: ExecutionContextLike) {
    if (controller.cron === DAILY_CRON) {
      // Warn users about upcoming album expiry (~30 days out), then run the actual retirement
      // sweep. Both fire on the same daily tick. waitUntil so each runs independently.
      ctx.waitUntil(callCronRoute('/api/cron/notify-expiry', env, ctx))
      ctx.waitUntil(callCronRoute('/api/cron/retire-albums', env, ctx))
    }
  },
}

export default worker
