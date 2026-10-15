/** Can this host reach the careers SMTP server? Connect + banner only: no login, no mail. STRICTLY READ-ONLY. */
import net from "node:net";
import tls from "node:tls";

const HOST = process.env.CAREERS_SMTP_HOST || "mail.teammas.co.in";
const probe = (port: number, secure: boolean) => new Promise<string>((resolve) => {
  const s = (secure ? tls.connect : net.connect)({ host: HOST, port, servername: HOST, timeout: 8000 } as never);
  let buf = "";
  s.on("data", (d: Buffer) => { buf += d; if (buf.includes("\n")) { s.destroy(); resolve(buf.trim().slice(0, 120)); } });
  s.on("error", (e: NodeJS.ErrnoException) => resolve(`ERR ${e.code}`));
  s.on("timeout", () => { s.destroy(); resolve("timeout"); });
});
(async () => {
  for (const [port, secure] of [[25, false], [587, false], [465, true]] as const) console.log(HOST, port, await probe(port, secure));
})();
