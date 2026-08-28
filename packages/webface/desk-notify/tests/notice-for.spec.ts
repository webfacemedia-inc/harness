import { describe, expect, it } from 'vitest'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { noticeFor } from '../src/index.ts'

const session = { id: 's1' } as unknown as Session
const ev = (type: string, data: Record<string, unknown> = {}): SessionEvent => ({ type, data } as unknown as SessionEvent)

describe('noticeFor', () => {
  it('turns an approval request into an approval notice naming the tool', () => {
    expect(noticeFor(session, ev('approval/asked', { toolName: 'gmail_send', reason: 'quote to Dana' })))
      .toEqual({ kind: 'approval', sessionId: 's1', title: 'Desk needs your approval', body: 'gmail_send — quote to Dana' })
  })
  it('names a generic action when the approval carries no tool', () => {
    expect(noticeFor(session, ev('approval/asked'))?.body).toBe('an action')
  })
  it('turns a question into a question notice, clipped to 140 characters', () => {
    const q = 'x'.repeat(200)
    const n = noticeFor(session, ev('ask-user/question', { question: q }))
    expect(n?.kind).toBe('question'); expect(n?.body).toHaveLength(140)
  })
  it('ignores the answer to a question', () => {
    expect(noticeFor(session, ev('ask-user/question/answered', { question: 'x' }))).toBeUndefined()
  })
  it('detects a browser hand-over in an assistant message', () => {
    expect(noticeFor(session, ev('assistant/message', { text: 'I need you for a moment: sign in to Xero' }))?.kind).toBe('handover')
  })
  it('stays quiet for ordinary assistant messages and unrelated events', () => {
    expect(noticeFor(session, ev('assistant/message', { text: 'Done.' }))).toBeUndefined()
    expect(noticeFor(session, ev('tool/call'))).toBeUndefined()
  })
})
