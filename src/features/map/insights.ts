import { createServerFn } from '@tanstack/react-start'
import { regionInsightInputSchema } from './contracts'

export const getRegionInsights = createServerFn({ method: 'POST' })
  .inputValidator(regionInsightInputSchema)
  .handler(async ({ data }) => {
    const { calculateRegionInsights } = await import('./insights.server.ts')
    return calculateRegionInsights(data)
  })
