import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ports = [1420, 1421];
const releasableCommands = new Set(["node"]);
const projectRoot = realpathSync(fileURLToPath(new URL("..", import.meta.url)));

function getProcessCwd(pid) {
  try {
    const output = execFileSync("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });

    const cwdLine = output
      .split("\n")
      .find((line) => line.startsWith("n"));

    if (!cwdLine) {
      return null;
    }

    return realpathSync(cwdLine.slice(1));
  } catch {
    return null;
  }
}

function listListeners(port) {
  try {
    const output = execFileSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-Fpc"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });

    const listeners = [];

    for (const line of output.split("\n")) {
      if (!line) {
        continue;
      }

      const field = line[0];
      const value = line.slice(1);

      if (field === "p") {
        listeners.push({ pid: value, command: "unknown", cwd: getProcessCwd(value) });
      } else if (field === "c" && listeners.length > 0) {
        listeners[listeners.length - 1].command = value;
      }
    }

    return listeners;
  } catch {
    return [];
  }
}

for (const port of ports) {
  for (const listener of listListeners(port)) {
    const shouldRelease =
      releasableCommands.has(listener.command) && listener.cwd === projectRoot;

    if (!shouldRelease) {
      const cwd = listener.cwd ? ` from ${listener.cwd}` : "";
      console.warn(
        `Port ${port} is in use by pid ${listener.pid} (${listener.command})${cwd}; not auto-stopping it.`,
      );
      continue;
    }

    try {
      process.kill(Number(listener.pid), "SIGTERM");
      console.log(`Released stale dev port ${port} from pid ${listener.pid}.`);
    } catch (error) {
      console.warn(
        `Port ${port} is in use by pid ${listener.pid}, but it could not be stopped: ${error.message}`,
      );
    }
  }
}

await new Promise((resolve) => setTimeout(resolve, 250));

const blockedPorts = ports
  .map((port) => ({ port, listeners: listListeners(port) }))
  .filter(({ listeners }) => listeners.length > 0);

if (blockedPorts.length > 0) {
  for (const { port, listeners } of blockedPorts) {
    const owners = listeners
      .map((listener) => `${listener.pid} (${listener.command})`)
      .join(", ");

    console.error(`Port ${port} is still in use by pid(s): ${owners}.`);
  }
  console.error("Stop the listed process or rerun with permissions that can terminate it.");
  process.exit(1);
}
