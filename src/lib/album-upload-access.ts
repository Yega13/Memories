import { createAdminClient } from '@/lib/supabase/admin'

type AdminClient = ReturnType<typeof createAdminClient>

export type UploadAlbum = {
  id: string
  user_id: string | null
}

export type UploadAlbumLookup =
  | { ok: true; admin: AdminClient; album: UploadAlbum }
  | { ok: false; status: number; error: string }

const MISSING_COLUMN_CODES = new Set(['42703', 'PGRST204'])

function isMissingColumnError(error: { code?: string; message?: string }) {
  return MISSING_COLUMN_CODES.has(error.code ?? '') || /column .* does not exist|schema cache/i.test(error.message ?? '')
}

export async function lookupUploadAlbumById(
  albumId: string,
  routeName: string,
  options: { checkGuestUploads?: boolean } = {},
): Promise<UploadAlbumLookup> {
  let admin: AdminClient
  try {
    admin = createAdminClient()
  } catch (err) {
    console.error(`[${routeName}] createAdminClient failed:`, err instanceof Error ? err.message : String(err))
    return { ok: false, status: 503, error: 'Service configuration error. Please try again.' }
  }

  const { data: album, error: albumError } = await admin
    .from('albums')
    .select('id, user_id')
    .eq('id', albumId)
    .maybeSingle<UploadAlbum>()

  if (albumError) {
    console.error(
      `[${routeName}] album lookup failed:`,
      JSON.stringify({
        code: albumError.code,
        message: albumError.message,
        details: albumError.details,
        hint: albumError.hint,
        albumId,
      }),
    )
    return { ok: false, status: 503, error: 'Could not verify album. Please try again.' }
  }

  if (!album) {
    console.warn(`[${routeName}] album not found:`, albumId)
    return { ok: false, status: 404, error: 'Album not found' }
  }

  if (options.checkGuestUploads) {
    const { data: guestRow, error: guestError } = await admin
      .from('albums')
      .select('guest_uploads_enabled')
      .eq('id', albumId)
      .maybeSingle<{ guest_uploads_enabled: boolean | null }>()

    if (guestError) {
      if (isMissingColumnError(guestError)) {
        console.warn(`[${routeName}] guest_uploads_enabled missing; defaulting guest uploads to enabled`)
      } else {
        console.error(
          `[${routeName}] guest upload permission lookup failed:`,
          JSON.stringify({
            code: guestError.code,
            message: guestError.message,
            details: guestError.details,
            hint: guestError.hint,
            albumId,
          }),
        )
        return { ok: false, status: 503, error: 'Could not verify album upload permissions. Please try again.' }
      }
    } else if (guestRow?.guest_uploads_enabled === false) {
      return { ok: false, status: 403, error: 'Guest uploads are not enabled for this album' }
    }
  }

  return { ok: true, admin, album }
}
