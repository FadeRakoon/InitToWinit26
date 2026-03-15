import { bigint, doublePrecision, pgTable } from "drizzle-orm/pg-core";

export const surgeReturnLevels = pgTable("surge_return_levels", {
  stationId: bigint("station_id", { mode: "number" }).primaryKey(),
  lat: doublePrecision("lat").notNull(),
  lon: doublePrecision("lon").notNull(),
  rp1Bestfit: doublePrecision("rp1_bestfit").notNull(),
  rp1Lower5: doublePrecision("rp1_lower5").notNull(),
  rp1Upper95: doublePrecision("rp1_upper95").notNull(),
  rp2Bestfit: doublePrecision("rp2_bestfit").notNull(),
  rp2Lower5: doublePrecision("rp2_lower5").notNull(),
  rp2Upper95: doublePrecision("rp2_upper95").notNull(),
  rp5Bestfit: doublePrecision("rp5_bestfit").notNull(),
  rp5Lower5: doublePrecision("rp5_lower5").notNull(),
  rp5Upper95: doublePrecision("rp5_upper95").notNull(),
  rp10Bestfit: doublePrecision("rp10_bestfit").notNull(),
  rp10Lower5: doublePrecision("rp10_lower5").notNull(),
  rp10Upper95: doublePrecision("rp10_upper95").notNull(),
  rp25Bestfit: doublePrecision("rp25_bestfit").notNull(),
  rp25Lower5: doublePrecision("rp25_lower5").notNull(),
  rp25Upper95: doublePrecision("rp25_upper95").notNull(),
  rp50Bestfit: doublePrecision("rp50_bestfit").notNull(),
  rp50Lower5: doublePrecision("rp50_lower5").notNull(),
  rp50Upper95: doublePrecision("rp50_upper95").notNull(),
  rp75Bestfit: doublePrecision("rp75_bestfit").notNull(),
  rp75Lower5: doublePrecision("rp75_lower5").notNull(),
  rp75Upper95: doublePrecision("rp75_upper95").notNull(),
  rp100Bestfit: doublePrecision("rp100_bestfit").notNull(),
  rp100Lower5: doublePrecision("rp100_lower5").notNull(),
  rp100Upper95: doublePrecision("rp100_upper95").notNull(),
  evaScale: doublePrecision("eva_scale").notNull(),
  evaShape: doublePrecision("eva_shape").notNull(),
  evaLoc: doublePrecision("eva_loc").notNull(),
});

export type SurgeReturnLevelRow = typeof surgeReturnLevels.$inferSelect;
export type NewSurgeReturnLevelRow = typeof surgeReturnLevels.$inferInsert;
