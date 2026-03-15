import {
  bigint,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export interface WorldPopRecord {
  id: string;
  title?: string;
  desc?: string;
  doi?: string;
  date?: string;
  popyear?: string;
  citation?: string;
  data_file?: string;
  archive?: string;
  public?: string;
  source?: string;
  data_format?: string;
  author_email?: string;
  author_name?: string;
  maintainer_name?: string;
  maintainer_email?: string;
  project?: string;
  category?: string;
  gtype?: string;
  continent?: string;
  country?: string;
  iso3?: string;
  files?: string[];
  url_img?: string;
  organisation?: string;
  license?: string;
  url_summary?: string;
}

export const worldpopCountryPayloads = pgTable(
  "worldpop_country_payloads",
  {
    worldpopId: bigint("worldpop_id", { mode: "number" }).primaryKey(),
    datasetAlias: text("dataset_alias").notNull(),
    iso3: text("iso3").notNull(),
    countryName: text("country_name").notNull(),
    continent: text("continent"),
    populationYear: integer("population_year").notNull(),
    sourceDate: date("source_date", { mode: "string" }),
    payload: jsonb("payload").$type<WorldPopRecord>().notNull(),
    syncedAt: timestamp("synced_at", { mode: "string", withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp("created_at", { mode: "string", withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "string", withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("worldpop_country_payloads_dataset_iso3_year_idx").on(
      table.datasetAlias,
      table.iso3,
      table.populationYear,
    ),
    index("worldpop_country_payloads_iso3_year_idx").on(table.iso3, table.populationYear),
    index("worldpop_country_payloads_dataset_idx").on(table.datasetAlias),
    index("worldpop_country_payloads_payload_gin_idx").using("gin", table.payload),
  ],
);

export type WorldpopCountryPayloadRow = typeof worldpopCountryPayloads.$inferSelect;
export type NewWorldpopCountryPayloadRow = typeof worldpopCountryPayloads.$inferInsert;
