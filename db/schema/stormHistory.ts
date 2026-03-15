import {
  bigserial,
  date,
  doublePrecision,
  index,
  integer,
  pgTable,
  text,
} from "drizzle-orm/pg-core";

export const stormHistoryPoints = pgTable(
  "storm_history_points",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    stormId: text("storm_id").notNull(),
    stormName: text("storm_name").notNull(),
    stormDate: date("storm_date", { mode: "string" }).notNull(),
    stormTime: text("storm_time").notNull(),
    recordId: text("record_id"),
    status: text("status").notNull(),
    lat: doublePrecision("lat").notNull(),
    lon: doublePrecision("lon").notNull(),
    windKt: integer("wind_kt").notNull(),
    pressureMb: integer("pressure_mb"),
  },
  (table) => [index("storm_history_points_storm_id_date_time_idx").on(table.stormId, table.stormDate, table.stormTime)],
);

export type StormHistoryPointRow = typeof stormHistoryPoints.$inferSelect;
export type NewStormHistoryPointRow = typeof stormHistoryPoints.$inferInsert;
