// The one composition. Duration is whatever the beat sheet adds up to, so the
// reel and the poster both derive entirely from work/<slug>/reel.staged.json.
import React from 'react'
import { Composition } from 'remotion'
import { Reel, FPS, type ReelProps } from './Reel'

const sample: ReelProps = {
  business: 'Maple & Main',
  accent: '#3499cc',
  assetBase: '',
  beats: [
    { kind: 'hook', seconds: 4, title: 'Maple & Main', line: 'Your next customer just emailed. Who answers?' },
    { kind: 'cta', seconds: 5, title: 'Live until Friday', line: 'Your Desk is already running.' },
  ],
}

export const Root: React.FC = () => (
  <Composition
    id="Reel"
    component={Reel}
    width={1280}
    height={720}
    fps={FPS}
    defaultProps={sample}
    calculateMetadata={({ props }) => ({
      durationInFrames: Math.max(FPS, props.beats.reduce((n, b) => n + Math.round(b.seconds * FPS), 0)),
      props,
    })}
  />
)
