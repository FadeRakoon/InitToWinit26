import {
  doublePrecision,
  index,
  integer,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core'

export const terrainSummaries = pgTable(
  'terrain_summaries',
  {
    tileName: text('tile_name').primaryKey(),
    sourceKey: text('source_key').notNull(),
    minElevationM: doublePrecision('min_elevation_m').notNull(),
    maxElevationM: doublePrecision('max_elevation_m').notNull(),
    meanElevationM: doublePrecision('mean_elevation_m').notNull(),
    landCoveragePct: doublePrecision('land_coverage_pct').notNull(),
    pixelCount: integer('pixel_count').notNull(),
    validPixelCount: integer('valid_pixel_count').notNull(),
    landPixelCount: integer('land_pixel_count').notNull(),
    sourceUpdatedAt: timestamp('source_updated_at', {
      mode: 'string',
      withTimezone: true,
    }),
    createdAt: timestamp('created_at', {
      mode: 'string',
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', {
      mode: 'string',
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [index('terrain_summaries_source_key_idx').on(table.sourceKey)],
)

export type TerrainSummaryRow = typeof terrainSummaries.$inferSelect
export type NewTerrainSummaryRow = typeof terrainSummaries.$inferInsert
