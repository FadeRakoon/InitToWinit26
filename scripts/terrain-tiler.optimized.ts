import {
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { fromArrayBuffer } from "geotiff";
import { availableParallelism } from "node:os";
import sharp from "sharp";

console.log("Starting terrain tiler...");
console.log("BUCKET:", process.env.SOURCE_BUCKET);
console.log("AWS_REGION:", process.env.AWS_REGION);
console.log("S3_ENDPOINT:", process.env.S3_ENDPOINT);
console.log("AWS_ACCESS_KEY_ID set:", !!process.env.AWS_ACCESS_KEY_ID);
console.log(
  "AWS_SECRET_ACCESS_KEY set:",
  !!process.env.AWS_SECRET_ACCESS_KEY
);

const BUCKET = process.env.SOURCE_BUCKET ?? "";
const S3_ENDPOINT = process.env.S3_ENDPOINT ?? "";
const MIN_ZOOM = Number(process.env.MIN_ZOOM ?? 10);
const MAX_ZOOM = Number(process.env.MAX_ZOOM ?? 15);
const TILE_SIZE = 256;
const CPU_COUNT = availableParallelism();
const TILE_CONCURRENCY = Math.max(
  1,
  Number(process.env.TILE_CONCURRENCY ?? Math.min(Math.max(CPU_COUNT - 2, 8), 24))
);
const PNG_COMPRESSION_LEVEL = Math.max(
  0,
  Math.min(9, Number(process.env.PNG_COMPRESSION_LEVEL ?? 3))
);

sharp.concurrency(
  Math.max(
    1,
    Number(process.env.SHARP_CONCURRENCY ?? Math.min(CPU_COUNT, 32))
  )
);

const s3 = new S3Client({
  region: process.env.AWS_REGION ?? "auto",
  endpoint: S3_ENDPOINT,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? "",
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? "",
  },
  forcePathStyle: S3_ENDPOINT.length > 0,
});

interface TileResult {
  sourceFile: string;
  skipped: boolean;
  reason?: string;
  tilesGenerated: number;
}

interface TileJob {
  tx: number;
  ty: number;
  left: number;
  top: number;
  width: number;
  height: number;
}

const server = Bun.serve({
  port: process.env.PORT ?? 3000,
  async fetch(request: Request) {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return new Response("OK", { status: 200 });
    }

    if (url.pathname === "/generate-tiles" && request.method === "POST") {
      console.log("Received generate-tiles request");

      let body: { dryRun?: boolean; maxTiles?: number } = {};
      try {
        body = (await request.json()) as {
          dryRun?: boolean;
          maxTiles?: number;
        };
        console.log("Request body:", JSON.stringify(body));
      } catch {
        console.log("No body or invalid JSON, using defaults");
      }

      const dryRun = body.dryRun ?? false;
      const maxTiles = Number.isFinite(body.maxTiles)
        ? Math.max(0, body.maxTiles ?? 0)
        : Number.POSITIVE_INFINITY;

      try {
        const result = await generateAllTiles(dryRun, maxTiles);
        return new Response(JSON.stringify(result, null, 2), {
          headers: { "Content-Type": "application/json" },
        });
      } catch (error) {
        console.error("Tile generation failed:", error);
        const message =
          error instanceof Error ? error.message : "Unknown error";
        const stack = error instanceof Error ? error.stack : "";
        return new Response(JSON.stringify({ error: message, stack }), {
          status: 500,
        });
      }
    }

    return new Response("Not found", { status: 404 });
  },
});

console.log(`Terrain tiler running on port ${server.port}`);

async function generateAllTiles(
  dryRun: boolean,
  maxTiles: number
): Promise<{
  total: number;
  processed: number;
  skipped: number;
  tilesGenerated: number;
  results: TileResult[];
}> {
  console.log("Listing TIFF files from bucket:", BUCKET);
  const files = await listTiffFiles();
  console.log("Found", files.length, "TIFF files");

  const results: TileResult[] = [];
  let totalTilesGenerated = 0;
  let remainingTileBudget = maxTiles;

  for (const [index, file] of files.entries()) {
    if (!dryRun && remainingTileBudget <= 0) {
      console.log("Reached maxTiles limit:", maxTiles);
      break;
    }

    console.log("Processing file", index + 1, "of", files.length, ":", file);
    const result = await processTiffFile(file, dryRun, remainingTileBudget);
    results.push(result);
    totalTilesGenerated += result.tilesGenerated;
    remainingTileBudget -= result.tilesGenerated;
  }

  return {
    total: files.length,
    processed: results.filter((result) => !result.skipped).length,
    skipped: results.filter((result) => result.skipped).length,
    tilesGenerated: totalTilesGenerated,
    results,
  };
}

async function listTiffFiles(): Promise<string[]> {
  const files: string[] = [];
  let continuationToken: string | undefined;

  do {
    const response = await s3.send(
      new ListObjectsV2Command({
        Bucket: BUCKET,
        Prefix: "caribbean_tiles/",
        ContinuationToken: continuationToken,
      })
    );

    for (const object of response.Contents ?? []) {
      if (object.Key?.endsWith(".tif") || object.Key?.endsWith(".tiff")) {
        files.push(object.Key);
      }
    }

    continuationToken = response.NextContinuationToken;
  } while (continuationToken);

  return files;
}

async function processTiffFile(
  key: string,
  dryRun: boolean,
  tileBudget: number
): Promise<TileResult> {
  console.log("Downloading:", key);

  const response = await s3.send(
    new GetObjectCommand({
      Bucket: BUCKET,
      Key: key,
    })
  );

  const bytes = await response.Body?.transformToByteArray();
  if (!bytes) {
    return {
      sourceFile: key,
      skipped: true,
      reason: "Failed to download",
      tilesGenerated: 0,
    };
  }

  console.log("Parsing GeoTIFF:", key);
  const tiff = await fromArrayBuffer(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  );
  const image = await tiff.getImage();
  const width = image.getWidth();
  const height = image.getHeight();
  const bbox = image.getBoundingBox() as [number, number, number, number];
  const noDataValue = image.getGDALNoData();

  const elevation = (await image.readRasters({
    interleave: true,
    samples: [0],
  })) as Float32Array;

  console.log("TIFF dimensions:", width, "x", height);

  const waterCheck = isWaterOnly(elevation, noDataValue);
  if (waterCheck.isWater) {
    console.log("Skipping (water-only):", waterCheck.reason);
    return {
      sourceFile: key,
      skipped: true,
      reason: waterCheck.reason,
      tilesGenerated: 0,
    };
  }

  console.log("  BBox:", bbox.join(", "));
  console.log(
    "  Elevation range:",
    waterCheck.minElev?.toFixed(1),
    "m to",
    waterCheck.maxElev?.toFixed(1),
    "m"
  );

  if (dryRun) {
    console.log("Dry run - skipping tile generation");
    return {
      sourceFile: key,
      skipped: false,
      tilesGenerated: 0,
    };
  }

  const terrainRgb = encodeTerrainRgb(elevation, noDataValue, width, height);

  let generated = 0;
  let remaining = tileBudget;

  for (let zoom = MIN_ZOOM; zoom <= MAX_ZOOM; zoom++) {
    if (remaining <= 0) {
      break;
    }

    const created = await generateTilesForZoom({
      bbox,
      height,
      sourceKey: key,
      terrainRgb,
      tileBudget: remaining,
      width,
      z: zoom,
    });

    generated += created;
    remaining -= created;
  }

  console.log("Generated", generated, "tiles for", key);

  return {
    sourceFile: key,
    skipped: false,
    tilesGenerated: generated,
  };
}

function encodeTerrainRgb(
  elevation: Float32Array,
  noDataValue: number | null | undefined,
  width: number,
  height: number
): Buffer {
  const encoded = Buffer.allocUnsafe(width * height * 3);
  const noData = noDataValue ?? -32768;

  for (let index = 0; index < elevation.length; index++) {
    const value = elevation[index];
    const offset = index * 3;

    if (value === noData || Number.isNaN(value) || value < -10000) {
      encoded[offset] = 0;
      encoded[offset + 1] = 0;
      encoded[offset + 2] = 0;
      continue;
    }

    const clamped = Math.max(-10000, Math.min(100000, value));
    const terrainValue = Math.round((clamped + 10000) * 10);
    encoded[offset] = (terrainValue >> 16) & 0xff;
    encoded[offset + 1] = (terrainValue >> 8) & 0xff;
    encoded[offset + 2] = terrainValue & 0xff;
  }

  return encoded;
}

function isWaterOnly(
  elevation: Float32Array,
  noDataValue: number | null | undefined
): { isWater: boolean; reason?: string; minElev?: number; maxElev?: number } {
  const noData = noDataValue ?? -32768;

  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let validCount = 0;

  for (const value of elevation) {
    if (value !== noData && !Number.isNaN(value) && value > -1000) {
      min = Math.min(min, value);
      max = Math.max(max, value);
      validCount += 1;
    }
  }

  if (validCount === 0) {
    return { isWater: true, reason: "No valid elevation data (all nodata)" };
  }

  if (max < 0) {
    return {
      isWater: true,
      reason: `All elevations below sea level (max: ${max.toFixed(1)}m)`,
      minElev: min,
      maxElev: max,
    };
  }

  const variance = max - min;
  if (validCount > 100 && variance < 1 && max < 5) {
    return {
      isWater: true,
      reason: `Insufficient variance (${variance.toFixed(2)}m), likely flat water`,
      minElev: min,
      maxElev: max,
    };
  }

  return { isWater: false, minElev: min, maxElev: max };
}

async function generateTilesForZoom({
  bbox,
  height,
  sourceKey,
  terrainRgb,
  tileBudget,
  width,
  z,
}: {
  bbox: [number, number, number, number];
  height: number;
  sourceKey: string;
  terrainRgb: Buffer;
  tileBudget: number;
  width: number;
  z: number;
}): Promise<number> {
  const jobs = createTileJobs(bbox, width, height, z).slice(0, tileBudget);
  console.log(`  z${z}: Generating ${jobs.length} tiles`);

  let generated = 0;

  await runPool(jobs, TILE_CONCURRENCY, async (job) => {
    const tileData = await sharp(terrainRgb, {
      raw: {
        width,
        height,
        channels: 3,
      },
    })
      .extract({
        left: job.left,
        top: job.top,
        width: job.width,
        height: job.height,
      })
      .resize(TILE_SIZE, TILE_SIZE, { kernel: "nearest" })
      .png({
        adaptiveFiltering: false,
        compressionLevel: PNG_COMPRESSION_LEVEL,
        effort: 1,
      })
      .toBuffer();

    await uploadTile(tileData, `tiles/${z}/${job.tx}/${job.ty}.png`);
    generated += 1;
  });

  console.log(`  z${z}: Uploaded ${generated} tiles from ${sourceKey}`);
  return generated;
}

function createTileJobs(
  bbox: [number, number, number, number],
  width: number,
  height: number,
  z: number
): TileJob[] {
  const [minLon, minLat, maxLon, maxLat] = bbox;
  const minTileX = Math.floor(lonToTileX(minLon, z));
  const maxTileX = Math.ceil(lonToTileX(maxLon, z));
  const minTileY = Math.floor(latToTileY(maxLat, z));
  const maxTileY = Math.ceil(latToTileY(minLat, z));
  const jobs: TileJob[] = [];

  for (let tx = minTileX; tx < maxTileX; tx++) {
    for (let ty = minTileY; ty < maxTileY; ty++) {
      const tileBounds = tileToBounds(tx, ty, z);
      const left = clampPixelIndex(
        Math.floor(((tileBounds.minLon - minLon) / (maxLon - minLon)) * width),
        width
      );
      const right = clampPixelEdge(
        Math.ceil(((tileBounds.maxLon - minLon) / (maxLon - minLon)) * width),
        width
      );
      const top = clampPixelIndex(
        Math.floor(((maxLat - tileBounds.maxLat) / (maxLat - minLat)) * height),
        height
      );
      const bottom = clampPixelEdge(
        Math.ceil(((maxLat - tileBounds.minLat) / (maxLat - minLat)) * height),
        height
      );
      const cropWidth = Math.max(1, right - left);
      const cropHeight = Math.max(1, bottom - top);

      jobs.push({
        tx,
        ty,
        left,
        top,
        width: cropWidth,
        height: cropHeight,
      });
    }
  }

  return jobs;
}

function clampPixelIndex(value: number, max: number): number {
  return Math.max(0, Math.min(max - 1, value));
}

function clampPixelEdge(value: number, max: number): number {
  return Math.max(1, Math.min(max, value));
}

function lonToTileX(lon: number, z: number): number {
  return ((lon + 180) / 360) * 2 ** z;
}

function latToTileY(lat: number, z: number): number {
  const clampedLat = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const radians = (clampedLat * Math.PI) / 180;
  const mercator = Math.log(Math.tan(Math.PI / 4 + radians / 2));
  return ((1 - mercator / Math.PI) / 2) * 2 ** z;
}

function tileToBounds(tx: number, ty: number, z: number) {
  const n = 2 ** z;
  return {
    minLon: (tx / n) * 360 - 180,
    maxLon: ((tx + 1) / n) * 360 - 180,
    minLat: tileYToLat(ty + 1, z),
    maxLat: tileYToLat(ty, z),
  };
}

function tileYToLat(y: number, z: number): number {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z;
  return (180 / Math.PI) * Math.atan(Math.sinh(n));
}

async function uploadTile(data: Buffer, key: string): Promise<void> {
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: data,
      ContentType: "image/png",
    })
  );
}

async function runPool<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>
): Promise<void> {
  let nextIndex = 0;

  async function runWorker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      await worker(items[currentIndex], currentIndex);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () =>
      runWorker()
    )
  );
}
