import { getCommandArgsSchema } from "../contracts/command-args";
import { parseCliArgs } from "../core/cli-args";
import { buildTerminalLeafHelp } from "../core/command-registry";
import { resolveNoteSyncTarget, syncNoteFile } from "../notes/note-sync";

interface NoteSyncOptions {
  help: boolean;
  project: string;
  path: string;
  section: string;
  text: string;
  style: string;
  slot: string;
  maxItems: string;
  useStdin: boolean;
}

interface NoteSyncTarget {
  kind: string;
  label: string;
  filePath: string;
}

interface NoteSyncResult {
  changed: boolean;
  filePath: string;
}


async function runNoteSyncCommand(config: unknown, args: string[] = []) {
  const options = parseNoteSyncArgs(args);
  if (options.help) {
    console.log(buildTerminalLeafHelp("note.sync"));
    return;
  }

  const text = await resolveBody(options);
  if (!text) {
    throw new Error("note 内容不能为空，传 --text 或通过 stdin 输入");
  }

  const target = resolveNoteSyncTarget(
    config as Parameters<typeof resolveNoteSyncTarget>[0],
    options,
  );
  const result = syncNoteFile({
    filePath: target.filePath,
    section: options.section,
    text,
    style: options.style,
    slot: options.slot,
    maxItems: options.maxItems,
  });

  const action = result.changed ? "updated" : "noop";
  console.log(`note ${action}: ${result.filePath} [${options.section}]`);
}

function parseNoteSyncArgs(args: string[]): NoteSyncOptions {
  return parseCliArgs<NoteSyncOptions>(args, getCommandArgsSchema("noteSync"));
}

async function resolveBody(options: NoteSyncOptions): Promise<string> {
  const inline = String(options.text || "").trim();
  if (inline) {
    return inline;
  }
  if (!options.useStdin && process.stdin.isTTY) {
    return "";
  }
  return readStdin();
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let buffer = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk: string) => {
      buffer += chunk;
    });
    process.stdin.on("end", () => resolve(buffer.trim()));
    process.stdin.on("error", reject);
  });
}

export {
  parseNoteSyncArgs,
  runNoteSyncCommand,
};
