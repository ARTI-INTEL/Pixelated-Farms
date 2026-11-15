export async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  const text = await response.text()
  let body: (T & { error?: string }) | null = null
  try {
    body = text ? (JSON.parse(text) as T & { error?: string }) : null
  } catch {
    throw new Error('The server returned an unreadable response.')
  }
  if (!response.ok)
    throw new Error(body?.error || `Request failed (${response.status}).`)
  return body as T
}

export const postJson = <T,>(url: string, body: unknown) =>
  request<T>(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

export const patchJson = <T,>(url: string, body: unknown) =>
  request<T>(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
