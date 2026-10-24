import { Storage } from "@google-cloud/storage";
import { randomUUID } from "node:crypto";

const sidecar = "http://127.0.0.1:1106";
const storage = new Storage({
  credentials: {
    audience: "replit", subject_token_type: "access_token",
    token_url: `${sidecar}/token`, type: "external_account",
    credential_source: { url: `${sidecar}/credential`, format: { type: "json", subject_token_field_name: "access_token" } },
    universe_domain: "googleapis.com",
  },
  projectId: "",
});
export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export function privateFile(path: string) {
  const dir = process.env.PRIVATE_OBJECT_DIR;
  if (!dir || !path.startsWith(`${dir}/classos/`)) throw new Error("Private file storage is unavailable.");
  const [, bucket, ...parts] = path.split("/");
  return storage.bucket(bucket).file(parts.join("/"));
}
export async function reservePrivateFile() {
  const dir = process.env.PRIVATE_OBJECT_DIR;
  if (!dir) throw new Error("Private file storage is not configured.");
  const objectPath = `${dir}/classos/${randomUUID()}`;
  const [, bucket, ...parts] = `${objectPath}.incoming`.split("/");
  const response = await fetch(`${sidecar}/object-storage/signed-object-url`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bucket_name: bucket, object_name: parts.join("/"), method: "PUT",
      expires_at: new Date(Date.now() + 10 * 60_000).toISOString() }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error("File storage could not reserve an upload. Try again.");
  const { signed_url } = await response.json() as { signed_url: string };
  return { objectPath, uploadURL: signed_url as string };
}
// Read one exact generation with an enforced streaming limit. Never trust the declared size.
export async function readIncoming(path: string, size: number) {
  const file = privateFile(`${path}.incoming`);
  const [metadata] = await file.getMetadata();
  if (Number(metadata.size) !== size || size > MAX_FILE_BYTES) throw new Error("Uploaded file size does not match the reservation.");
  const [bucket, ...parts] = path.replace(/^\//, "").split("/");
  const snapshot = storage.bucket(bucket).file(`${parts.join("/")}.incoming`, { generation: metadata.generation });
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of snapshot.createReadStream()) {
    total += chunk.length;
    if (total > MAX_FILE_BYTES || total > size) throw new Error("Uploaded file exceeds its size limit.");
    chunks.push(Buffer.from(chunk));
  }
  if (total !== size) throw new Error("The upload is incomplete. Upload the file again.");
  return Buffer.concat(chunks);
}
export async function sealPrivateFile(path: string, bytes: Buffer, contentType: string) {
  await privateFile(path).save(bytes, { resumable: false, preconditionOpts: { ifGenerationMatch: 0 },
    metadata: { contentType, cacheControl: "private, no-store" } });
  await privateFile(`${path}.incoming`).delete({ ignoreNotFound: true }).catch(() => {});
}
