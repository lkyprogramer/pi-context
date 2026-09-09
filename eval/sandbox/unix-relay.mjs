#!/usr/bin/env node
import http from "node:http";

const sock = process.env.PCR_BROKER_SOCK || "/run/pctx/broker.sock";
const port = Number(process.env.PCR_RELAY_PORT || 8080);

http.createServer((req, res) => {
  const proxy = http.request(
    { socketPath: sock, path: req.url, method: req.method, headers: req.headers },
    (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers);
      up.pipe(res);
    },
  );
  proxy.on("error", () => {
    if (!res.headersSent) res.writeHead(502, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { type: "PCR_RELAY" } }));
  });
  req.pipe(proxy);
}).listen(port, "127.0.0.1");
