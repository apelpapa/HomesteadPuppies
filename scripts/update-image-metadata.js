import { extname } from "path";
import {
  CopyObjectCommand,
  HeadObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import env from "dotenv";
import pg from "pg";

env.config({ path: ".env" });

const bucket = process.env.BUCKET;
if (!bucket) throw new Error("BUCKET is required.");

const db = new pg.Client({
  host: process.env.PGHOST,
  port: Number(process.env.PGPORT || 5432),
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  ssl: process.env.PGSSL === "true" ? { rejectUnauthorized: false } : false,
});
const s3 = new S3Client();
const contentTypes = new Map([
  [".avif", "image/avif"],
  [".gif", "image/gif"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".png", "image/png"],
  [".webp", "image/webp"],
]);

function encodeCopySource(key) {
  return `${bucket}/${key
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/")}`;
}

await db.connect();

try {
  const result = await db.query(`
    SELECT imageid FROM puppyimages
    UNION
    SELECT imageid FROM parentimages
    ORDER BY imageid
  `);
  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (const { imageid: key } of result.rows) {
    const contentType = contentTypes.get(extname(key).toLowerCase());
    if (!contentType) {
      skipped += 1;
      console.warn(`Skipped unknown image extension: ${key}`);
      continue;
    }

    try {
      const head = await s3.send(
        new HeadObjectCommand({ Bucket: bucket, Key: key }),
      );
      await s3.send(
        new CopyObjectCommand({
          Bucket: bucket,
          Key: key,
          CopySource: encodeCopySource(key),
          MetadataDirective: "REPLACE",
          Metadata: head.Metadata,
          CacheControl: "public, max-age=31536000, immutable",
          ContentDisposition: "inline",
          ContentType: contentType,
        }),
      );
      updated += 1;
    } catch (error) {
      failed += 1;
      console.error(`Unable to update ${key}: ${error.message}`);
    }
  }

  console.log(
    `Updated ${updated} image object(s); skipped ${skipped}; failed ${failed}.`,
  );

  if (failed > 0) process.exitCode = 1;
} finally {
  await db.end();
}
