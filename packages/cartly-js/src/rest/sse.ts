import { CartlyApiError, ErrorCode } from "../errors"

export interface SseEvent {
  event: string
  data: unknown
}

/**
 * Splits buffered server-sent-events text into complete events; `rest` is an
 * unfinished event to prepend to the next chunk. Events whose data isn't JSON
 * are skipped.
 */
export function parseSse(buffer: string): { events: SseEvent[]; rest: string } {
  const blocks = buffer.replace(/\r\n/g, "\n").split("\n\n")
  const rest = blocks.pop() ?? ""
  const events: SseEvent[] = []
  for (const block of blocks) {
    let event = "message"
    const data: string[] = []
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim()
      else if (line.startsWith("data:")) data.push(line.slice(5).trimStart())
    }
    if (data.length === 0) continue
    try {
      events.push({ event, data: JSON.parse(data.join("\n")) as unknown })
    } catch {
      // A malformed event is skipped; the stream's last event still ends it.
    }
  }
  return { events, rest }
}

/**
 * Reads a `text/event-stream` response to its end, calling `onEvent` for
 * each event. A refusal before the stream starts is the API's JSON error and
 * rejects as a CartlyApiError. Works wherever `fetch` streams response
 * bodies (browsers, Node, Bun; React Native needs a streaming fetch).
 */
export async function readSse(
  response: Response,
  onEvent: (event: SseEvent) => void
): Promise<void> {
  if (!response.ok || !response.body) {
    let code: string = ErrorCode.INTERNAL_ERROR
    let message = "The server couldn’t answer just now. Try again."
    try {
      const json = (await response.json()) as {
        error?: { code?: string; message?: string }
      }
      code = json.error?.code ?? code
      message = json.error?.message ?? message
    } catch {
      // Not JSON: keep the generic message.
    }
    throw new CartlyApiError({ code, message, status: response.status })
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  for (;;) {
    const { done, value } = await reader.read()
    if (value) buffer += decoder.decode(value, { stream: !done })
    const parsed = parseSse(done ? `${buffer}\n\n` : buffer)
    buffer = parsed.rest
    for (const event of parsed.events) onEvent(event)
    if (done) break
  }
}
