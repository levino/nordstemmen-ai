import { createHash } from 'node:crypto';
import { B2_API_BASE } from './config.ts';
import { withRetry } from './retry.ts';

export interface B2Config {
  keyId: string;
  appKey: string;
  bucketId: string;
  bucketName: string;
}

interface B2Auth {
  authToken: string;
  apiUrl: string;
  downloadUrl: string;
}

export function createB2Service(config: B2Config) {
  let auth: B2Auth | null = null;

  async function authorize(): Promise<void> {
    const credentials = Buffer.from(`${config.keyId}:${config.appKey}`).toString('base64');

    const data = await withRetry(
      async () => {
        const resp = await fetch(`${B2_API_BASE}/b2api/v3/b2_authorize_account`, {
          headers: { Authorization: `Basic ${credentials}` },
        });
        if (!resp.ok) throw new Error(`B2 auth failed: ${resp.status}`);
        return resp.json() as Promise<Record<string, unknown>>;
      },
      { retries: 3, baseDelay: 2000 },
    );

    const storageApi = (data.apiInfo as Record<string, unknown>).storageApi as Record<string, string>;
    auth = {
      authToken: data.authorizationToken as string,
      apiUrl: storageApi.apiUrl,
      downloadUrl: storageApi.downloadUrl,
    };
  }

  async function fileExists(fileName: string): Promise<boolean> {
    if (!auth) throw new Error('B2 not authorized');
    const resp = await fetch(`${auth.downloadUrl}/file/${config.bucketName}/${fileName}`, {
      headers: { Authorization: auth.authToken },
      method: 'HEAD',
    });
    return resp.status === 200;
  }

  async function uploadFile(fileName: string, data: Buffer | Uint8Array, contentType: string): Promise<void> {
    await withRetry(
      async () => {
        if (!auth) throw new Error('B2 not authorized');

        const urlResp = await fetch(`${auth.apiUrl}/b2api/v3/b2_get_upload_url`, {
          method: 'POST',
          headers: { Authorization: auth.authToken },
          body: JSON.stringify({ bucketId: config.bucketId }),
        });
        if (!urlResp.ok) throw new Error(`B2 get upload URL failed: ${urlResp.status}`);
        const urlData = (await urlResp.json()) as Record<string, string>;

        const sha1 = createHash('sha1').update(data).digest('hex');

        const uploadResp = await fetch(urlData.uploadUrl, {
          method: 'POST',
          headers: {
            Authorization: urlData.authorizationToken,
            'X-Bz-File-Name': fileName,
            'Content-Type': contentType,
            'Content-Length': String(data.length),
            'X-Bz-Content-Sha1': sha1,
          },
          body: data,
        });
        if (!uploadResp.ok) throw new Error(`B2 upload failed: ${uploadResp.status}`);
      },
      { retries: 3, baseDelay: 2000 },
    );
  }

  return { authorize, fileExists, uploadFile };
}
