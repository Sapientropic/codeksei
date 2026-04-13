import { getCommandArgsSchema } from "../../contracts/command-args";
import { parseCliArgs } from "../../core/cli-args";
import { normalizeBody } from "./shared";

interface DiaryWriteOptions extends Record<string, unknown> {
  text?: unknown;
  title?: unknown;
  date?: string;
  time?: string;
  section?: unknown;
  state?: unknown;
  timelineText?: unknown;
  useStdin?: boolean;
}


export type { DiaryWriteOptions };

export function parseArgs(args: string[]): DiaryWriteOptions {
  return parseCliArgs(args, getCommandArgsSchema("diaryWrite"));
}

export async function resolveBody(options: DiaryWriteOptions): Promise<string> {
  const inlineText = normalizeBody(options.text);
  if (inlineText) {
    return inlineText;
  }
  if (!options.useStdin && process.stdin.isTTY) {
    return "";
  }
  return normalizeBody(await readStdin());
}

export function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let buffer = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk: string) => {
      buffer += chunk;
    });
    process.stdin.on("end", () => resolve(buffer));
    process.stdin.on("error", reject);
  });
}
