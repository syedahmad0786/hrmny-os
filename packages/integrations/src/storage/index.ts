/** Portable object storage — Supabase now, S3/Blob later. */

export type PutObjectInput = {
  path: string;
  body: Uint8Array | string;
  contentType?: string;
};

export type PutObjectResult = {
  path: string;
  size: number;
};

export type SignedUrlResult = {
  url: string;
  expiresAt: string;
};

export interface ObjectStore {
  put(input: PutObjectInput): Promise<PutObjectResult>;
  signedUrl(path: string, ttlSeconds: number): Promise<SignedUrlResult>;
  remove?(path: string): Promise<void>;
}

function toBytes(body: PutObjectInput["body"]): Uint8Array {
  if (typeof body === "string") {
    const enc = new TextEncoder();
    return enc.encode(body);
  }
  return body;
}

/** In-memory DAM for local/dev without Supabase Storage. */
export function createMemoryObjectStore(): ObjectStore {
  const blobs = new Map<string, { body: Uint8Array; contentType: string }>();

  return {
    async put(input) {
      const body = toBytes(input.body);
      blobs.set(input.path, {
        body,
        contentType: input.contentType ?? "application/octet-stream",
      });
      return { path: input.path, size: body.byteLength };
    },
    async signedUrl(path, ttlSeconds) {
      if (!blobs.has(path)) {
        throw new Error(`Object not found: ${path}`);
      }
      const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
      return {
        url: `memory://dam/${encodeURIComponent(path)}?expires=${expiresAt}`,
        expiresAt,
      };
    },
    async remove(path) {
      blobs.delete(path);
    },
  };
}

type UploadFn = (
  path: string,
  body: Uint8Array,
  opts?: { contentType?: string; upsert?: boolean },
) => Promise<{ error: { message: string } | null }>;

type SignedUrlFn = (
  path: string,
  expiresIn: number,
) => Promise<{ data: { signedUrl: string } | null; error: { message: string } | null }>;

export type SupabaseStorageClient = {
  storage: {
    from: (bucket: string) => {
      upload: UploadFn;
      createSignedUrl: SignedUrlFn;
      remove: (paths: string[]) => Promise<{ error: { message: string } | null }>;
    };
  };
};

export function createSupabaseObjectStore(
  client: SupabaseStorageClient,
  bucket: string,
): ObjectStore {
  return {
    async put(input) {
      const body = toBytes(input.body);
      const { error } = await client.storage.from(bucket).upload(input.path, body, {
        contentType: input.contentType,
        upsert: false,
      });
      if (error) throw new Error(error.message);
      return { path: input.path, size: body.byteLength };
    },
    async signedUrl(path, ttlSeconds) {
      const { data, error } = await client.storage
        .from(bucket)
        .createSignedUrl(path, ttlSeconds);
      if (error || !data) throw new Error(error?.message ?? "signedUrl failed");
      return {
        url: data.signedUrl,
        expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
      };
    },
    async remove(path) {
      const { error } = await client.storage.from(bucket).remove([path]);
      if (error) throw new Error(error.message);
    },
  };
}
