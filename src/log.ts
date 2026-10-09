import { appendFileSync, mkdirSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";

export const DEFAULT_MAX_LOG_BYTES = 5 * 1024 * 1024;

export type FsLike = {
  append(path: string, text: string): void;
  /** Size in bytes, or undefined when the file does not exist yet. */
  size(path: string): number | undefined;
  rotate(from: string, to: string): void;
  ensureDir(dir: string): void;
};

const nodeFs: FsLike = {
  append: (path, text) => appendFileSync(path, text),
  size: (path) => {
    try {
      return statSync(path).size;
    } catch {
      return undefined;
    }
  },
  rotate: (from, to) => renameSync(from, to),
  ensureDir: (dir) => mkdirSync(dir, { recursive: true }),
};

/** Log file location: the profile logs directory, or nothing when no profile directory is known. */
export function resolveLogFile(env: Record<string, string | undefined>): string | undefined {
  const profileDir = env.DSH_PROFILE_DIR;
  if (profileDir === undefined || profileDir.length === 0) return undefined;
  return join(profileDir, "logs", "dsh-fixes.log");
}

export function createLogSink(options: {
  file: string | undefined;
  maxBytes?: number;
  fs?: FsLike;
  onFailure?: (message: string) => void;
}): { write(line: string): void } {
  const { file } = options;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_LOG_BYTES;
  const fs = options.fs ?? nodeFs;
  let ensured = false;
  // After the first failure the file is abandoned for this process; console output is unaffected.
  let disabled = false;

  return {
    write(line: string): void {
      if (file === undefined || disabled) return;
      try {
        if (!ensured) {
          const slash = Math.max(file.lastIndexOf("/"), file.lastIndexOf("\\"));
          if (slash > 0) fs.ensureDir(file.slice(0, slash));
          ensured = true;
        }
        const size = fs.size(file);
        if (size !== undefined && size >= maxBytes) fs.rotate(file, `${file}.1`);
        fs.append(file, `${line}\n`);
      } catch (error) {
        disabled = true;
        options.onFailure?.(error instanceof Error ? error.message : String(error));
      }
    },
  };
}

export function formatLogArgs(args: unknown[]): string {
  return args
    .map((arg) => {
      if (arg instanceof Error) return arg.message;
      if (typeof arg === "string") return arg;
      try {
        return JSON.stringify(arg) ?? String(arg);
      } catch {
        return String(arg);
      }
    })
    .join(" ");
}

export function formatDiag(stage: string, detail: Record<string, unknown>): string {
  return `[diag] ${stage} ${JSON.stringify(detail)}`;
}
