import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { RawSessionIndex, RawSessionMeta } from "../../data/models.js";

/**
 * Resolve the real project path from an encoded directory name.
 * Strategy: check session-meta and JSONL for actual paths, fallback to
 * filesystem probing, then encoded path as last resort.
 */
export async function resolveProjectPath(
  encodedPath: string,
  projectDir: string,
  metaCache: Map<string, RawSessionMeta> | null,
): Promise<string> {
  // 1. Check sessions-index originalPath
  const indexPath = join(projectDir, "sessions-index.json");
  const indexData = await readJSON<RawSessionIndex>(indexPath);
  if (indexData?.originalPath) return indexData.originalPath;

  // 2. Check session-meta for any session in this project
  if (metaCache) {
    for (const meta of metaCache.values()) {
      if (meta.project_path) {
        const metaEncoded = meta.project_path.replace(/\//g, "-").replace(/^-/, "-");
        if (encodedPath === metaEncoded || meta.project_path.endsWith(lastPathSegments(encodedPath))) {
          return meta.project_path;
        }
      }
    }
  }

  // 3. Check first JSONL file for cwd
  const files = await readdir(projectDir).catch(() => []);
  for (const file of files) {
    if (!file.endsWith(".jsonl")) continue;
    const firstLine = await readFirstLine(join(projectDir, file));
    if (firstLine) {
      try {
        const msg = JSON.parse(firstLine);
        if (msg.cwd) return msg.cwd;
      } catch { /* ignore */ }
    }
    break; // only check first JSONL
  }

  // 4. Try filesystem probing: walk from the root trying to find a real path
  const parts = encodedPath.replace(/^-/, "").split("-");
  let current = "/";
  for (let i = 0; i < parts.length; i++) {
    const candidates = [parts[i]];
    for (let j = i + 1; j < parts.length; j++) {
      candidates.push(parts.slice(i, j + 1).join("-"));
    }
    let found = false;
    for (const candidate of candidates.reverse()) {
      const testPath = join(current, candidate);
      const s = await stat(testPath).catch(() => null);
      if (s?.isDirectory()) {
        current = testPath;
        i += candidate.split("-").length - 1;
        found = true;
        break;
      }
    }
    if (!found) {
      current = join(current, parts[i]);
    }
  }
  if (current !== "/") {
    const s = await stat(current).catch(() => null);
    if (s?.isDirectory()) return current;
  }

  // 5. Fallback: naive decode
  return "/" + encodedPath.replace(/^-/, "").replace(/-/g, "/");
}

function lastPathSegments(encoded: string): string {
  const parts = encoded.replace(/^-/, "").split("-");
  return parts.slice(-3).join("-");
}

async function readFirstLine(filePath: string): Promise<string | null> {
  try {
    const content = await readFile(filePath, "utf-8");
    const newlineIdx = content.indexOf("\n");
    return newlineIdx > 0 ? content.slice(0, newlineIdx) : content;
  } catch {
    return null;
  }
}

async function readJSON<T>(path: string): Promise<T | null> {
  try {
    const content = await readFile(path, "utf-8");
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}
