import { execFile, type ExecFileOptionsWithStringEncoding } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const DEFAULT_OPTIONS: ExecFileOptionsWithStringEncoding = {
  encoding: "utf8",
  timeout: 15_000,
  maxBuffer: 1024 * 1024,
  windowsHide: true,
};

export type OpenClawExecError = Error & {
  stdout?: string | Buffer;
  stderr?: string | Buffer;
  code?: number | string | null;
};

export async function runOpenclaw(
  args: string[],
  options?: Partial<ExecFileOptionsWithStringEncoding>
) {
  const result = await execFileAsync("openclaw", args, {
    ...DEFAULT_OPTIONS,
    ...options,
  });

  return result.stdout.trim();
}
