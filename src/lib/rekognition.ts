import {
  RekognitionClient,
  CreateCollectionCommand,
  IndexFacesCommand,
  SearchFacesByImageCommand,
  DeleteFacesCommand,
} from '@aws-sdk/client-rekognition'

export function createRekognitionClient() {
  return new RekognitionClient({
    region: process.env.AWS_REGION ?? 'eu-north-1',
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    },
  })
}

export function collectionId(albumId: string) {
  return `hushare-${albumId}`
}

export async function ensureCollection(client: RekognitionClient, albumId: string) {
  try {
    await client.send(new CreateCollectionCommand({ CollectionId: collectionId(albumId) }))
  } catch (err: unknown) {
    // Already exists — that's fine
    if ((err as { name?: string }).name !== 'ResourceAlreadyExistsException') throw err
  }
}

export async function indexPhotoFaces(
  client: RekognitionClient,
  albumId: string,
  photoId: string,
  imageUrl: string,
): Promise<string[]> {
  const res = await fetch(imageUrl)
  if (!res.ok) throw new Error(`Failed to fetch image: ${res.status}`)
  const bytes = new Uint8Array(await res.arrayBuffer())

  const result = await client.send(
    new IndexFacesCommand({
      CollectionId: collectionId(albumId),
      Image: { Bytes: bytes },
      ExternalImageId: photoId,
      DetectionAttributes: [],
      MaxFaces: 15,
      QualityFilter: 'AUTO',
    }),
  )

  return (result.FaceRecords ?? []).map((r) => r.Face!.FaceId!)
}

export async function searchFacesByImage(
  client: RekognitionClient,
  albumId: string,
  selfieBytes: Uint8Array,
  threshold = 80,
): Promise<{ photoId: string; similarity: number }[]> {
  const result = await client.send(
    new SearchFacesByImageCommand({
      CollectionId: collectionId(albumId),
      Image: { Bytes: selfieBytes },
      MaxFaces: 100,
      FaceMatchThreshold: threshold,
    }),
  )

  const seen = new Set<string>()
  const matches: { photoId: string; similarity: number }[] = []
  for (const match of result.FaceMatches ?? []) {
    const photoId = match.Face?.ExternalImageId
    const similarity = match.Similarity ?? 0
    if (photoId && !seen.has(photoId)) {
      seen.add(photoId)
      matches.push({ photoId, similarity })
    }
  }
  return matches.sort((a, b) => b.similarity - a.similarity)
}

export async function deleteFaces(
  client: RekognitionClient,
  albumId: string,
  faceIds: string[],
) {
  if (!faceIds.length) return
  await client.send(
    new DeleteFacesCommand({ CollectionId: collectionId(albumId), FaceIds: faceIds }),
  )
}
