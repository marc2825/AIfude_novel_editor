import { createServer, request } from "node:http";
/** A real socket outage, including SW requests. WebKit's setOffline navigation has an upstream bug. */
export async function networkOutageProxy(target: string) {
  let offline = false;
  const server = createServer((incoming, outgoing) => {
    if (offline) { incoming.socket.destroy(); return; }
    const destination = new URL(incoming.url ?? "/", target);
    const forward = request(destination, { method: incoming.method, headers: { ...incoming.headers, host: destination.host } }, (response) => {
      outgoing.writeHead(response.statusCode ?? 502, response.headers); response.pipe(outgoing);
    });
    forward.on("error", () => outgoing.destroy()); incoming.pipe(forward);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("No fixture port");
  return { origin: `http://127.0.0.1:${address.port}`, setOffline: (value: boolean) => { offline = value; },
    close: () => new Promise<void>((resolve, reject) => { server.closeAllConnections(); server.close((error) => error ? reject(error) : resolve()); }) };
}
