import { spawn } from "node:child_process";

export type CommandResult = { code: number; stdout: string; stderr: string };

/** Runs commands; replaced in tests so nothing is installed for real. */
export interface Runner {
  run(command: string, args: string[], options: { cwd: string }): Promise<CommandResult>;
}

export const processRunner: Runner = {
  run(command, args, { cwd }) {
    return new Promise((resolve) => {
      const child = spawn(command, args, { cwd, shell: process.platform === "win32", env: process.env });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
      child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
      child.on("error", (error) => resolve({ code: 127, stdout, stderr: stderr || error.message }));
      child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
    });
  },
};
