import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * A running, purely local static server for the E2E fixtures. It binds to
 * 127.0.0.1 on an ephemeral port and serves only files inside this directory,
 * so a test can never reach the public internet through it.
 */
export interface FixtureServer {
  /** Origin such as `http://127.0.0.1:53124` — the E2E's only allowed origin. */
  readonly origin: string;
  close(): Promise<void>;
}

// dirname(...) yields no trailing separator, so the `FIXTURES_DIR + sep`
// traversal guard below matches served paths instead of rejecting them all.
const FIXTURES_DIR = dirname(fileURLToPath(import.meta.url));

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".wasm": "application/wasm",
};

function resolveWithinFixtures(pathname: string): string | null {
  const decoded = decodeURIComponent(pathname);
  const relative = normalize(decoded).replace(/^([/\\])+/u, "");
  const absolute = resolve(join(FIXTURES_DIR, relative));
  // Reject any traversal outside the fixtures directory.
  if (absolute !== FIXTURES_DIR && !absolute.startsWith(FIXTURES_DIR + sep)) {
    return null;
  }
  return absolute;
}

export function startFixtureServer(): Promise<FixtureServer> {
  const server: Server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const filePath = resolveWithinFixtures(url.pathname);

    if (
      filePath === null ||
      !existsSync(filePath) ||
      !statSync(filePath).isFile()
    ) {
      response.statusCode = 404;
      response.end("Not found");
      return;
    }

    response.statusCode = 200;
    response.setHeader(
      "Content-Type",
      CONTENT_TYPES[extname(filePath).toLowerCase()] ??
        "application/octet-stream",
    );
    // No caching so each run reflects the current fixture exactly.
    response.setHeader("Cache-Control", "no-store");
    createReadStream(filePath).pipe(response);
  });

  return new Promise<FixtureServer>((resolvePromise, rejectPromise) => {
    server.on("error", rejectPromise);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        rejectPromise(new Error("Fixture server did not bind to a TCP port."));
        return;
      }
      resolvePromise({
        origin: `http://127.0.0.1:${address.port}`,
        close: () =>
          new Promise<void>((done, fail) => {
            server.close((error) => (error ? fail(error) : done()));
          }),
      });
    });
  });
}
