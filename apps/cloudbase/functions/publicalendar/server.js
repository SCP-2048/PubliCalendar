"use strict";

const http = require("node:http");
const { main } = require("./handler.js");

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  const method = (req.method || "GET").toUpperCase();
  const url = req.url || "/";
  const path = url.includes("?") ? url.slice(0, url.indexOf("?")) : url;

  if (method === "OPTIONS") {
    // CloudBase gateway usually handles preflight; keep a minimal local fallback.
    res.writeHead(204, {
      "Content-Type": "text/plain",
    });
    res.end();
    return;
  }

  try {
    const body = method === "GET" || method === "HEAD" ? "" : await readBody(req);
    const result = await main({
      httpMethod: method,
      path,
      body: body || undefined,
      headers: req.headers,
    });

    const statusCode = result?.statusCode ?? 200;
    const headers = {
      "Content-Type": "application/json; charset=utf-8",
      ...(result?.headers || {}),
    };
    // Avoid conflicting with gateway CORS (invalid "origin,*" merge).
    delete headers["Access-Control-Allow-Origin"];
    delete headers["Access-Control-Allow-Headers"];
    delete headers["Access-Control-Allow-Methods"];
    delete headers["access-control-allow-origin"];
    delete headers["access-control-allow-headers"];
    delete headers["access-control-allow-methods"];

    const payload =
      typeof result?.body === "string" ? result.body : JSON.stringify(result?.body ?? result);

    res.writeHead(statusCode, headers);
    res.end(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "服务器暂时不可用";
    res.writeHead(500, {
      "Content-Type": "application/json; charset=utf-8",
    });
    res.end(JSON.stringify({ error: message }));
  }
});

const port = Number(process.env.PORT || 9000);
server.listen(port, "0.0.0.0", () => {
  console.log(`PubliCalendar listening on ${port}`);
});
