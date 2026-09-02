// The reel: five kinds of beat on one design system — white ground, serif
// display, the brand blue, real screen captures inside a browser frame with a
// slow push-in so they read as produced footage, and one caption at a time.
// Everything per-prospect arrives as props; nothing here is edited per reel.
import React from 'react'
import {
  AbsoluteFill, Img, OffthreadVideo, Series, interpolate, spring,
  staticFile, useCurrentFrame, useVideoConfig,
} from 'remotion'

export const FPS = 30

type Beat =
  | { kind: 'hook'; seconds: number; title: string; line: string }
  | { kind: 'beforeAfter'; seconds: number; before: string; after: string; line: string }
  | { kind: 'clip'; seconds: number; src: string; rate?: number; line: string }
  | { kind: 'cta'; seconds: number; title: string; line: string }

export type ReelProps = { business: string; accent: string; assetBase: string; beats: Beat[] }

const SERIF = "Fraunces, Georgia, 'Times New Roman', serif"
const SANS = "'Inter Tight', -apple-system, 'Segoe UI', sans-serif"
const INK = '#111111'
const MUTE = '#6b6b6b'
// Videos load from the staged public dir; stills arrive inlined as data URIs
// (Remotion's public-dir resolution is unreliable under `render`, and images
// are small enough to embed).
const asset = (base: string, f: string) =>
  /^(data:|https?:)/.test(f) ? f : staticFile(base ? `${base}/${f}` : f)

/** The one caption: a dark pill, bottom centre, in and out on springs. */
const Caption: React.FC<{ line: string; frames: number }> = ({ line, frames }) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const enter = spring({ frame: frame - 8, fps, config: { damping: 200 } })
  const exit = interpolate(frame, [frames - 12, frames - 2], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  return (
    <div style={{
      position: 'absolute', bottom: 44, left: 0, right: 0, display: 'flex', justifyContent: 'center',
      opacity: Math.min(enter, exit), transform: `translateY(${(1 - enter) * 24}px)`,
    }}>
      <div style={{
        maxWidth: 900, background: 'rgba(10,14,17,0.88)', color: '#fdfdfd', borderRadius: 14,
        padding: '16px 26px', font: `600 30px/1.35 ${SANS}`, textAlign: 'center',
      }}>{line}</div>
    </div>
  )
}

const Wordmark: React.FC<{ accent: string; size?: number }> = ({ accent, size = 30 }) => (
  <div style={{ font: `600 ${size}px ${SANS}`, color: INK }}>
    webfaCe<span style={{ fontFamily: SERIF, color: accent, marginLeft: '0.18em' }}>Desk</span>
  </div>
)

const Hook: React.FC<{ title: string; line: string; accent: string; frames: number }> = ({ title, line, accent, frames }) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const inSpring = spring({ frame, fps, config: { damping: 200 } })
  const lineIn = spring({ frame: frame - Math.round(fps * 0.7), fps, config: { damping: 200 } })
  const bar = interpolate(frame, [0, fps * 0.8], [0, 120], { extrapolateRight: 'clamp' })
  const out = interpolate(frame, [frames - 10, frames], [1, 0], { extrapolateLeft: 'clamp' })
  return (
    <AbsoluteFill style={{ background: '#fafafa', alignItems: 'center', justifyContent: 'center', opacity: out }}>
      <div style={{ position: 'absolute', top: 48, left: 56 }}><Wordmark accent={accent} /></div>
      <div style={{ width: bar, height: 8, background: accent, borderRadius: 4, marginBottom: 34 }} />
      <div style={{
        font: `600 92px/1.05 ${SERIF}`, color: INK, letterSpacing: '-0.015em', textAlign: 'center',
        maxWidth: 1080, transform: `translateY(${(1 - inSpring) * 40}px)`, opacity: inSpring,
      }}>{title}</div>
      <div style={{
        font: `500 34px/1.4 ${SANS}`, color: MUTE, marginTop: 26, maxWidth: 900, textAlign: 'center',
        transform: `translateY(${(1 - lineIn) * 30}px)`, opacity: lineIn,
      }}>{line}</div>
    </AbsoluteFill>
  )
}

/** Their site today wipes away to the redesign, labels riding each side. */
const BeforeAfter: React.FC<{ before: string; after: string; line: string; accent: string; base: string; frames: number }> =
  ({ before, after, line, accent, base, frames }) => {
    const frame = useCurrentFrame()
    const { fps } = useVideoConfig()
    const wipe = interpolate(frame, [fps * 1.2, fps * 3.2], [0, 100], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
    const chip = (text: string, on: boolean, color: string) => (
      <div style={{
        position: 'absolute', top: 28, left: 28, zIndex: 2, opacity: on ? 1 : 0,
        background: color, color: '#fff', borderRadius: 999, padding: '10px 22px', font: `600 24px ${SANS}`,
      }}>{text}</div>
    )
    const shot: React.CSSProperties = { width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top' }
    return (
      <AbsoluteFill style={{ background: '#0a0e11' }}>
        <AbsoluteFill>
          <Img src={asset(base, before)} style={{ ...shot, filter: 'saturate(0.55)' }} />
          {chip('your site today', wipe < 55, '#5b6b7a')}
        </AbsoluteFill>
        <AbsoluteFill style={{ clipPath: `inset(0 ${100 - wipe}% 0 0)` }}>
          <Img src={asset(base, after)} style={shot} />
          {chip('your new site', wipe >= 55, accent)}
        </AbsoluteFill>
        <div style={{
          position: 'absolute', top: 0, bottom: 0, left: `${wipe}%`, width: 5, background: accent,
          opacity: wipe > 0 && wipe < 100 ? 1 : 0,
        }} />
        <Caption line={line} frames={frames} />
      </AbsoluteFill>
    )
  }

/** A real capture inside a browser frame, sped up, with a slow push-in. */
const Clip: React.FC<{ src: string; rate: number; line: string; base: string; frames: number }> =
  ({ src, rate, line, base, frames }) => {
    const frame = useCurrentFrame()
    const zoom = interpolate(frame, [0, frames], [1, 1.06])
    return (
      <AbsoluteFill style={{ background: '#0a0e11', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{
          width: 1120, borderRadius: 18, overflow: 'hidden', boxShadow: '0 40px 90px rgba(0,0,0,0.55)',
          transform: `scale(${zoom})`, background: '#1a2129',
        }}>
          <div style={{ display: 'flex', gap: 8, padding: '14px 18px', background: '#1a2129' }}>
            {['#ff5f57', '#febc2e', '#28c840'].map(c => <div key={c} style={{ width: 13, height: 13, borderRadius: 999, background: c }} />)}
          </div>
          <OffthreadVideo src={asset(base, src)} playbackRate={rate} muted style={{ width: '100%', display: 'block' }} />
        </div>
        <Caption line={line} frames={frames} />
      </AbsoluteFill>
    )
  }

const Cta: React.FC<{ title: string; line: string; accent: string; business: string; frames: number }> =
  ({ title, line, accent, business, frames }) => {
    const frame = useCurrentFrame()
    const { fps } = useVideoConfig()
    const inSpring = spring({ frame, fps, config: { damping: 200 } })
    return (
      <AbsoluteFill style={{ background: accent, alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ font: `600 26px ${SANS}`, color: 'rgba(255,255,255,0.85)', marginBottom: 18 }}>{business}</div>
        <div style={{
          font: `600 84px/1.1 ${SERIF}`, color: '#ffffff', letterSpacing: '-0.01em', textAlign: 'center', maxWidth: 1000,
          transform: `scale(${0.92 + inSpring * 0.08})`, opacity: inSpring,
        }}>{title}</div>
        <div style={{ font: `500 32px/1.4 ${SANS}`, color: 'rgba(255,255,255,0.92)', marginTop: 26, maxWidth: 860, textAlign: 'center' }}>{line}</div>
        <div style={{ position: 'absolute', bottom: 44, opacity: interpolate(frame, [frames - 40, frames - 20], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) }}>
          <div style={{ font: `600 30px ${SANS}`, color: '#fff' }}>
            webfaCe<span style={{ fontFamily: SERIF, marginLeft: '0.18em' }}>Desk</span>
          </div>
        </div>
      </AbsoluteFill>
    )
  }

export const Reel: React.FC<ReelProps> = ({ business, accent, assetBase, beats }) => (
  <Series>
    {beats.map((b, i) => {
      const frames = Math.round(b.seconds * FPS)
      return (
        <Series.Sequence key={i} durationInFrames={frames}>
          {b.kind === 'hook' && <Hook title={b.title} line={b.line} accent={accent} frames={frames} />}
          {b.kind === 'beforeAfter' && <BeforeAfter before={b.before} after={b.after} line={b.line} accent={accent} base={assetBase} frames={frames} />}
          {b.kind === 'clip' && <Clip src={b.src} rate={b.rate ?? 2} line={b.line} base={assetBase} frames={frames} />}
          {b.kind === 'cta' && <Cta title={b.title} line={b.line} accent={accent} business={business} frames={frames} />}
        </Series.Sequence>
      )
    })}
  </Series>
)
