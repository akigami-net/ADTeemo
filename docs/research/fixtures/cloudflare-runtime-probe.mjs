// Standalone local evidence for ADR 0008, not an ADTeemo deployment or a live Discord test.
// See ../deployment-platforms.md for pinned dependencies and the scope of these checks.
import assert from "node:assert/strict";
import { once } from "node:events";
import { WebSocketServer } from "ws";
import { Miniflare } from "miniflare";

const server = new WebSocketServer({ port: 0, host: "127.0.0.1" });
await once(server, "listening");
server.on("connection", (socket) => {
  socket.on("message", (data) => socket.send(data.toString()));
});
const mf = new Miniflare({
  modules: true,
  compatibilityDate: "2026-07-30",
  compatibilityFlags: ["nodejs_compat"],
  d1Databases: { DB: "probe" },
  durableObjects: {
    COORDINATOR: { className: "Coordinator", useSQLite: true },
  },
  bindings: { GATEWAY: `http://127.0.0.1:${server.address().port}` },
  script: `
    import dgram from 'node:dgram';
    export class Coordinator {
      constructor(ctx, env) { this.ctx = ctx; this.env = env; this.last = null; }
      async fetch(request) {
        const path = new URL(request.url).pathname;
        if (path === '/connect') {
          const response = await fetch(this.env.GATEWAY, { headers: { Upgrade: 'websocket' } });
          this.socket = response.webSocket;
          this.socket.accept();
          this.socket.addEventListener('message', event => { this.last = event.data; });
          return new Response('connected');
        }
        if (path === '/send') {
          this.socket.send('after-initial-request');
          return new Response('sent');
        }
        if (path === '/close') { this.socket?.close(); return new Response('closed'); }
        return Response.json({ last: this.last });
      }
    }
    export default {
      async fetch(request, env) {
        const path = new URL(request.url).pathname;
        if (path === '/udp') {
          try {
            const s = dgram.createSocket('udp4');
            try {
              let timer;
              try {
                await new Promise((resolve, reject) => {
                  timer = setTimeout(() => reject(new Error('UDP send did not complete within 500 ms')), 500);
                  s.once('error', reject);
                  s.send(new Uint8Array([1]), 9, '127.0.0.1', error => error ? reject(error) : resolve());
                });
              } finally { clearTimeout(timer); }
            } finally { s.close(); }
            return Response.json({ supported: true });
          }
          catch (error) { return Response.json({ supported: false, error: error.message }); }
        }
        if (path === '/signature') {
          const { key, signature, data } = await request.json();
          const pub = await crypto.subtle.importKey('raw', new Uint8Array(key), { name: 'Ed25519' }, false, ['verify']);
          const ok = await crypto.subtle.verify('Ed25519', pub, new Uint8Array(signature), new TextEncoder().encode(data));
          return Response.json({ ok });
        }
        if (path === '/join') {
          const { id } = await request.json();
          await env.DB.batch([
            env.DB.prepare('INSERT INTO members(user_id) SELECT ? WHERE (SELECT count(*) FROM members) < 1 ON CONFLICT DO NOTHING').bind(id),
            env.DB.prepare('INSERT INTO outbox(user_id) SELECT user_id FROM members WHERE user_id = ? ON CONFLICT DO NOTHING').bind(id)
          ]);
          return new Response('ok');
        }
        return env.COORDINATOR.get(env.COORDINATOR.idFromName('singleton')).fetch(request);
      }
    }
  `,
});

try {
  const db = await mf.getD1Database("DB");
  await db.batch([
    db.prepare("CREATE TABLE members(user_id TEXT PRIMARY KEY)"),
    db.prepare("CREATE TABLE outbox(user_id TEXT PRIMARY KEY)"),
  ]);
  // A later SQL failure must roll back the earlier write in the same batch.
  await assert.rejects(db.batch([
    db.prepare("INSERT INTO members VALUES ('rollback')"),
    db.prepare("INSERT INTO members VALUES ('rollback')"),
  ]));
  assert.equal(
    (await db.prepare("SELECT count(*) AS n FROM members").first()).n,
    0,
  );
  console.log(
    "PASS D1 batch rolls back all writes on a later constraint error",
  );

  await Promise.all(
    ["a", "b", "a", "b"].map((id) =>
      mf.dispatchFetch("http://probe/join", {
        method: "POST",
        body: JSON.stringify({ id }),
      }).then((r) => {
        assert.equal(r.status, 200);
      })
    ),
  );
  assert.equal(
    (await db.prepare("SELECT count(*) AS n FROM members").first()).n,
    1,
  );
  assert.equal(
    (await db.prepare("SELECT count(*) AS n FROM outbox").first()).n,
    1,
  );
  console.log(
    "PASS concurrent/retried last-slot joins create one participant and one outbox entry",
  );

  const pair = await crypto.subtle.generateKey("Ed25519", true, [
    "sign",
    "verify",
  ]);
  const data = '1795070000{"type":1}';
  const signature = [
    ...new Uint8Array(
      await crypto.subtle.sign(
        "Ed25519",
        pair.privateKey,
        new TextEncoder().encode(data),
      ),
    ),
  ];
  const key = [
    ...new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)),
  ];
  for (
    const [payload, expected] of [[data, true], [data + "tampered", false]]
  ) {
    const response = await mf.dispatchFetch("http://probe/signature", {
      method: "POST",
      body: JSON.stringify({ key, signature, data: payload }),
    });
    assert.equal((await response.json()).ok, expected);
  }
  console.log("PASS Ed25519 verifies the signed body and rejects tampering");

  assert.equal((await mf.dispatchFetch("http://probe/connect")).status, 200);
  assert.equal((await mf.dispatchFetch("http://probe/send")).status, 200);
  let last;
  for (let i = 0; i < 40; i++) {
    last = (await (await mf.dispatchFetch("http://probe/state")).json()).last;
    if (last) break;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.equal(last, "after-initial-request");
  await mf.dispatchFetch("http://probe/close");
  console.log(
    "PASS outbound Durable Object WebSocket remains usable after the initiating request",
  );

  const udp = await (await mf.dispatchFetch("http://probe/udp")).json();
  assert.equal(udp.supported, false);
  console.log("OBSERVED node:dgram send failed or timed out: " + udp.error);
} finally {
  await mf.dispose();
  for (const socket of server.clients) socket.terminate();
  await new Promise((resolve) => server.close(resolve));
}
