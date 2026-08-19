import * as https from 'https';

export interface HttpResult {
  status: number;
  body: Buffer;
  finalUrl: string;
}

export function httpGet(url: string, redirects = 0): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('Too many redirects'));
    const req = https.get(
      url,
      {
        headers: { 'User-Agent': 'RustServerManager/1.0' },
        timeout: 15_000,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if ([301, 302, 303, 307, 308].includes(status) && res.headers.location) {
          res.resume();
          const next = new URL(res.headers.location, url).toString();
          resolve(httpGet(next, redirects + 1));
          return;
        }
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => resolve({ status, body: Buffer.concat(chunks), finalUrl: url }));
      }
    );
    req.on('timeout', () => req.destroy(new Error('Request timeout')));
    req.on('error', reject);
  });
}
