'use client'

import { api, ApiError } from './api-client'

export const ID_PROOF_TYPES = ['image/jpeg', 'image/png', 'application/pdf'] as const
/** The API's JSON body limit (main.ts) bounds what the dev upload stand-in can carry. */
export const MAX_ID_PROOF_BYTES = 3 * 1024 * 1024

interface Presigned {
  id: string
  uploadUrl: string
  maxSizeBytes: number
}

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

/**
 * A photo straight off a phone camera is 3-8 MB; an ID proof needs far less.
 * Re-encodes a large JPEG/PNG at most 1600 px wide as JPEG. PDFs pass as they are.
 */
export async function shrinkImage(file: File): Promise<Blob> {
  if (!file.type.startsWith('image/') || file.size < 600 * 1024) return file
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82))
    return blob && blob.size < file.size ? blob : file
  } catch {
    return file
  }
}

/**
 * Uploads through the API's presign -> put -> validate flow (docs/18) and
 * returns the file id. The DEV storage provider takes the bytes at its own
 * /api/v1/uploads/dev-put URL; a real provider's URL takes a plain PUT.
 */
export async function uploadDocument(file: File): Promise<string> {
  const blob = await shrinkImage(file)
  const contentType = blob.type || file.type
  const presigned = await api.post<Presigned>('/uploads/presign', { purpose: 'DOCUMENT', contentType })
  if (blob.size > Math.min(presigned.maxSizeBytes, MAX_ID_PROOF_BYTES)) throw new ApiError('File too large', 413, null)

  if (presigned.uploadUrl.startsWith('/api/v1/')) {
    const result = await api.post<{ status: string; reason?: string }>(presigned.uploadUrl.slice('/api/v1'.length), { dataBase64: await toBase64(blob) })
    if (result.status !== 'ACTIVE') throw new ApiError(result.reason ?? 'Upload rejected', 422, { message: result.reason })
  } else {
    const res = await fetch(presigned.uploadUrl, { method: 'PUT', body: blob, headers: { 'Content-Type': contentType } })
    if (!res.ok) throw new ApiError('Upload failed', res.status, null)
  }
  return presigned.id
}
