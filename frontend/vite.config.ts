import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const generationResultCache = new Map<string, { createdAt: number; request?: unknown; response: unknown }>();

function pruneGenerationResultCache() {
  const cutoff = Date.now() - 1000 * 60 * 60 * 6;
  for (const [key, value] of generationResultCache.entries()) {
    if (value.createdAt < cutoff) generationResultCache.delete(key);
  }
}

function apiProxyPlugin(): Plugin {
  return {
    name: 'api-proxy',
    enforce: 'pre',
    configureServer(server) {
      const handler = (req: import('http').IncomingMessage, res: import('http').ServerResponse, next: () => void) => {
        if (!req.url?.startsWith('/api-proxy')) return next();

        if (req.method === 'GET' && /^\/api-proxy\/generation-results(?:\?|$)/.test(req.url)) {
          pruneGenerationResultCache();
          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'no-cache',
          });
          res.end(JSON.stringify({
            results: Array.from(generationResultCache.entries()).map(([clientTaskId, value]) => ({
              clientTaskId,
              ...value,
            })),
          }));
          return;
        }

        const assetMatch = req.method === 'GET' ? req.url.match(/^\/api-proxy\/asset(?:\?|$)/) : null;
        if (assetMatch) {
          const requestUrl = new URL(req.url, 'http://localhost');
          const assetUrl = requestUrl.searchParams.get('url');
          if (!assetUrl || !/^https?:\/\//i.test(assetUrl)) {
            res.writeHead(400, {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
              'Cache-Control': 'no-cache',
            });
            res.end(JSON.stringify({ error: 'Invalid asset url' }));
            return;
          }

          fetch(assetUrl, {
            method: 'GET',
            headers: {
              Accept: Array.isArray(req.headers.accept) ? req.headers.accept.join(', ') : req.headers.accept || '*/*',
            },
          })
            .then((assetResponse) => {
              if (!assetResponse.ok) {
                console.error('[api-proxy] asset error', {
                  assetUrl,
                  status: assetResponse.status,
                  statusText: assetResponse.statusText,
                });
              }
              res.writeHead(assetResponse.status, {
                'Content-Type': assetResponse.headers.get('content-type') || 'application/octet-stream',
                'Access-Control-Allow-Origin': '*',
                'Cache-Control': 'no-cache',
              });
              if (!assetResponse.body) {
                res.end();
                return;
              }
              const reader = assetResponse.body.getReader();
              const pump = async () => {
                while (true) {
                  const { done, value } = await reader.read();
                  if (done) { res.end(); break; }
                  res.write(value);
                }
              };
              pump().catch((err) => {
                console.error('[api-proxy] asset stream error:', err);
                res.end();
              });
            })
            .catch((error) => {
              console.error('[api-proxy] asset fetch error', { assetUrl, error });
              res.writeHead(502, {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Cache-Control': 'no-cache',
              });
              res.end(JSON.stringify({ error: String(error) }));
            });
          return;
        }

        const resultMatch = req.method === 'GET' ? req.url.match(/^\/api-proxy\/generation-result\/([^/?#]+)/) : null;
        if (resultMatch) {
          pruneGenerationResultCache();
          const result = generationResultCache.get(decodeURIComponent(resultMatch[1]));
          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'no-cache',
          });
          res.end(JSON.stringify(result ? { found: true, ...result } : { found: false }));
          return;
        }

        // CORS preflight
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', '*');
        if (req.method === 'OPTIONS') {
          res.writeHead(204);
          res.end();
          return;
        }

            const targetUrl = req.headers['x-target-url'] as string | undefined;
            const clientTaskId = req.headers['x-client-task-id'];
        if (!targetUrl) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing x-target-url header' }));
          return;
        }

        // Collect request body first, then forward
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', async () => {
          try {
            const body = chunks.length > 0 ? Buffer.concat(chunks) : undefined;

            const headers: Record<string, string> = {};
            if (req.headers['content-type'] || req.method !== 'GET') {
              headers['Content-Type'] = req.headers['content-type'] || 'application/json';
            }
            const forwardHeader = (name: string, targetName = name) => {
              const value = req.headers[name];
              if (!value) return;
              headers[targetName] = Array.isArray(value) ? value.join(', ') : value;
            };
            forwardHeader('authorization', 'Authorization');
            forwardHeader('x-goog-api-key', 'x-goog-api-key');
            forwardHeader('anthropic-version', 'anthropic-version');
            forwardHeader('accept', 'Accept');

            const response = await fetch(targetUrl, {
              method: req.method || 'GET',
              headers,
              body: body && body.length > 0 ? body : undefined,
            });

            if (!response.ok) {
              const errorText = await response.text();
              console.error('[api-proxy] upstream error', {
                targetUrl,
                method: req.method,
                status: response.status,
                statusText: response.statusText,
                requestHeaders: Object.keys(headers),
                body: errorText.slice(0, 4000),
              });

              res.writeHead(response.status, {
                'Content-Type': response.headers.get('content-type') || 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Cache-Control': 'no-cache',
              });
              res.end(errorText);
              return;
            }

            const contentType = response.headers.get('content-type') || 'application/json';
            const shouldLogResponse = req.method === 'POST' && /\/(?:chat\/completions|images\/generations|images\/edits|responses)(?:\?|$)/i.test(targetUrl);

            if (shouldLogResponse) {
              const responseText = await response.text();
              if (typeof clientTaskId === 'string' && clientTaskId.trim()) {
                let requestPayload: unknown;
                if (body && contentType.includes('json')) {
                  try {
                    requestPayload = JSON.parse(body.toString('utf8'));
                  } catch {
                    requestPayload = undefined;
                  }
                }
                try {
                  generationResultCache.set(clientTaskId, { createdAt: Date.now(), request: requestPayload, response: JSON.parse(responseText) });
                } catch {
                  generationResultCache.set(clientTaskId, { createdAt: Date.now(), request: requestPayload, response: responseText });
                }
              }
              console.log('[api-proxy] image response', {
                targetUrl,
                clientTaskId: typeof clientTaskId === 'string' ? clientTaskId : undefined,
                status: response.status,
                contentType,
                body: responseText.slice(0, 4000),
              });
              res.writeHead(response.status, {
                'Content-Type': contentType,
                'Access-Control-Allow-Origin': '*',
                'Cache-Control': 'no-cache',
                'X-Accel-Buffering': 'no',
              });
              res.end(responseText);
              return;
            }

            res.writeHead(response.status, {
              'Content-Type': contentType,
              'Access-Control-Allow-Origin': '*',
              'Cache-Control': 'no-cache',
              'X-Accel-Buffering': 'no',
            });

            // Stream response body chunk by chunk (supports SSE)
            if (response.body) {
              const reader = response.body.getReader();
              const pump = async () => {
                while (true) {
                  const { done, value } = await reader.read();
                  if (done) { res.end(); break; }
                  res.write(value);
                }
              };
              pump().catch((err) => {
                console.error('[api-proxy] stream error:', err);
                res.end();
              });
            } else {
              res.end();
            }
          } catch (err) {
            res.writeHead(502, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: String(err) }));
          }
        });
      };
      // Insert at front of middleware stack so it runs before Vite's internal handlers
      server.middlewares.stack.unshift({ route: '', handle: handler } as never);
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), apiProxyPlugin()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
  },
})
