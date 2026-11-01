import os from "node:os";
import { existsSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
export default function shell(args, config, signal) {
  if (typeof args.command !== "string" || !args.command) {
    throw new Error("缺少 command 参数");
  }
  if (args.workdir !== undefined && typeof args.workdir !== "string") {
    throw new Error("workdir 必须是字符串");
  }
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const windows = process.platform === "win32";
    let command = "/bin/sh";
    if (windows) {
      command = "powershell.exe";
    } else if (existsSync("/bin/bash")) {
      command = "/bin/bash";
    }
    const child = spawn(
      command,
      windows ? ["-NoProfile", "-NonInteractive", "-Command", args.command] : ["-c", args.command],
      {
        cwd: path.resolve(config.workdir || os.homedir(), args.workdir || "."),
        env: process.env,
        detached: !windows,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let text = "";
    let truncated = false;
    let timedOut = false;
    let finished = false;
    let killTimer;
    const append = (data) => {
      const chunk = data.toString();
      const room = Math.max(0, config.max_output - text.length);
      text += chunk.slice(0, room);
      if (chunk.length > room) {
        truncated = true;
      }
    };
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    const kill = () => {
      if (!child.pid) {
        return;
      }
      if (windows) {
        spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
          stdio: "ignore",
        }).on("error", () => child.kill());
      } else {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch (e) {
          if (e.code !== "ESRCH") {
            child.kill("SIGKILL");
          }
        }
      }
    };
    const stop = () => {
      kill();
      if (!killTimer) {
        killTimer = setTimeout(() => {
          child.stdout.destroy();
          child.stderr.destroy();
          finish(-1);
        }, 2000);
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      stop();
    }, config.timeout * 1000);
    const cleanup = () => {
      clearTimeout(timer);
      clearTimeout(killTimer);
      signal?.removeEventListener("abort", stop);
    };
    const finish = (code) => {
      if (finished) {
        return;
      }
      finished = true;
      cleanup();
      if (signal?.aborted) {
        reject(signal.reason);
        return;
      }
      resolve({
        failed: timedOut || code !== 0,
        text: `${text || "(无输出)"}${truncated ? "\n…（输出已截断）" : ""}${timedOut ? "\n[超时：命令已终止]" : ""}\n\n[退出码 ${code ?? -1}]`,
      });
    };
    signal?.addEventListener("abort", stop, { once: true });
    child.once("error", (error) => {
      if (finished) {
        return;
      }
      finished = true;
      cleanup();
      reject(error);
    });
    child.once("close", finish);
  });
}
