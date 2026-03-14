import type { ActivityTone, RegionAnalysis, RegionAnalysisInput } from './types'

const ACTIVITY_LEVELS: Array<{ label: string; tone: ActivityTone }> = [
  { label: 'Low', tone: 'low' },
  { label: 'Moderate', tone: 'moderate' },
  { label: 'High', tone: 'high' },
  { label: 'Critical', tone: 'critical' },
]

const INSIGHT_TEMPLATES = [
  'Surface modeling around {{label}} shows stable terrain with minor edge variance across the current viewport.',
  'Recent pattern matching around {{label}} suggests localized clustering near the north-west sector of the current focus.',
  'Cross-checks for {{label}} show low structural drift but elevated signal noise along the outer boundary.',
  'The current spatial fingerprint for {{label}} remains within expected bounds, with one corridor trending above the local baseline.',
  'Monitoring layers for {{label}} indicate a concentrated pocket of movement that deserves closer visual inspection.',
  'Predictive scoring for {{label}} points to a moderate chance of short-lived anomalies near the center line.',
]

const RECOMMENDATION_TEMPLATES = [
  'Continue passive monitoring and refresh the region after the next map move.',
  'Dispatch a follow-up review to compare this focus with adjacent cells.',
  'Flag this area for a second pass if the next search returns a similar pattern.',
  'Keep the current watch level and verify nearby corridors before escalating.',
]

export function generateRegionAnalysis(
  input: RegionAnalysisInput,
): RegionAnalysis {
  const seed = hashString(
    `${input.kind}:${input.label}:${input.center[0].toFixed(4)}:${input.center[1].toFixed(4)}`,
  )
  const activity = ACTIVITY_LEVELS[seed % ACTIVITY_LEVELS.length]
  const anomalies = seed % 5
  const firstInsight = interpolate(
    INSIGHT_TEMPLATES[seed % INSIGHT_TEMPLATES.length],
    input.label,
  )
  const secondInsight = interpolate(
    INSIGHT_TEMPLATES[(seed + 3) % INSIGHT_TEMPLATES.length],
    input.label,
  )
  const recommendation =
    RECOMMENDATION_TEMPLATES[(seed + anomalies) % RECOMMENDATION_TEMPLATES.length]

  return {
    badge: input.kind === 'cell' ? `Grid ${input.label}` : 'Search Focus',
    heading: input.kind === 'cell' ? `Region ${input.label}` : input.label,
    summary: [firstInsight, secondInsight],
    activityLabel: activity.label,
    activityTone: activity.tone,
    anomaliesLabel: `${anomalies} ${anomalies === 1 ? 'Anomaly' : 'Anomalies'}`,
    recommendation:
      anomalies > 0
        ? `${recommendation} ${input.label} should stay on the active watch list.`
        : `No immediate anomalies were confirmed. ${recommendation}`,
  }
}

function interpolate(template: string, label: string) {
  return template.replaceAll('{{label}}', label)
}

function hashString(value: string) {
  let hash = 0

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index)
    hash |= 0
  }

  return Math.abs(hash)
}
