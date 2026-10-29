// Runs the server (:8787) and the web app (:3000) together with prefixed logs.
import { spawn } from "node:child_process";

const procs = [
  ["server", "\x1b[35m", ["run", "dev", "-w", "@proass/server"]],
  ["web", "\x1b[36m", ["run", "dev", "-w", "@proass/web"]],
].map(([name, color, args]) => {
  const p = spawn("npm", args, { stdio: ["ignore", "pipe", "pipe"], env: process.env });
  const prefix = `${color}[${name}]\x1b[0m `;
  const pipe = (stream, out) =>
    stream.on("data", (d) => out.write(d.toString().replace(/^(?=.)/gm, prefix)));
  pipe(p.stdout, process.stdout);
  pipe(p.stderr, process.stderr);
  p.on("exit", (code) => {
    console.log(`${prefix}exited (${code})`);
    procs.forEach((q) => q.kill());
    process.exit(code ?? 0);
  });
  return p;
});

for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => procs.forEach((p) => p.kill(sig)));
