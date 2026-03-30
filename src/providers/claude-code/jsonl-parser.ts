import { readFile } from "node:fs/promises";
import type {
  Exchange,
  ExchangeCategory,
  TokenUsage,
  JSONLActivityStats,
  RawJSONLMessage,
} from "../../data/models.js";
import { calculateCost } from "../../core/token-ledger.js";
import { classifyExchangeCategory } from "./exchange-classifier.js";

export interface ParseResult {
  exchanges: Exchange[];
  gitBranch: string;
  activity: JSONLActivityStats;
  firstRawPrompt: string;
}

const EMPTY_ACTIVITY: JSONLActivityStats = {
  linesAdded: 0,
  linesRemoved: 0,
  filesModified: new Set(),
  filesRead: new Set(),
  editCount: 0,
  writeCount: 0,
  toolCounts: {},
};

export async function parseJSONL(filePath: string): Promise<ParseResult> {
  const content = await readFile(filePath, "utf-8").catch(() => "");
  if (!content) {
    return { exchanges: [], gitBranch: "", activity: { ...EMPTY_ACTIVITY, filesModified: new Set(), filesRead: new Set() }, firstRawPrompt: "" };
  }

  const exchanges: Exchange[] = [];
  const lines = content.split("\n").filter(Boolean);

  let currentUserPrompt = "";
  let firstRawPrompt = "";
  let sequenceNumber = 0;
  let gitBranch = "";

  const activity: JSONLActivityStats = {
    linesAdded: 0,
    linesRemoved: 0,
    filesModified: new Set(),
    filesRead: new Set(),
    editCount: 0,
    writeCount: 0,
    toolCounts: {},
  };

  for (const line of lines) {
    let msg: RawJSONLMessage;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }

    if (!gitBranch && msg.gitBranch) {
      gitBranch = msg.gitBranch;
    }

    if (msg.type === "system" || msg.type === "summary" || msg.type === "file-history-snapshot" || msg.type === "progress") {
      continue;
    }

    if (msg.type === "user") {
      if (msg.isCompactSummary || msg.isMeta) continue;

      const rawContent = (msg as any).message?.content ?? msg.content;
      if (typeof rawContent === "string") {
        if (
          rawContent.startsWith("<local-command") ||
          rawContent.startsWith("<task-notification") ||
          rawContent.startsWith("<command-name>")
        ) {
          continue;
        }
        currentUserPrompt = rawContent;
        if (!firstRawPrompt && rawContent.length > 10) firstRawPrompt = rawContent.split(/[\n\r]/)[0].trim();
      } else if (Array.isArray(rawContent)) {
        const textParts = rawContent
          .filter((c: any) => c.type === "text" && c.text)
          .map((c: any) => c.text as string);
        const joined = textParts.join(" ");
        currentUserPrompt = joined;
        if (!firstRawPrompt && joined.length > 10) firstRawPrompt = joined.split(/[\n\r]/)[0].trim();
      }
      continue;
    }

    if (msg.type === "assistant" && msg.message?.usage) {
      const usage = msg.message.usage;
      const model = msg.message.model || "unknown";

      if (model.startsWith("<synthetic>") || msg.type === "summary" as any) continue;
      const contentArr = Array.isArray(msg.message.content) ? msg.message.content : [];

      const toolsUsed: string[] = [];
      const filesRead: string[] = [];
      const filesModified: string[] = [];

      for (const block of contentArr) {
        if (block.type !== "tool_use" || !block.name) continue;
        toolsUsed.push(block.name);
        activity.toolCounts[block.name] = (activity.toolCounts[block.name] || 0) + 1;

        const input = block.input as Record<string, any> | undefined;
        if (!input) continue;

        const filePath_ = input.file_path || input.path || "";
        if (!filePath_) continue;
        const filePathStr = typeof filePath_ === "string" ? filePath_ : "";
        const fileName = filePathStr ? filePathStr.split("/").pop() || filePathStr : "";

        switch (block.name) {
          case "Read":
            activity.filesRead.add(filePathStr);
            filesRead.push(fileName);
            break;
          case "Edit": {
            activity.filesModified.add(filePathStr);
            activity.editCount++;
            filesModified.push(fileName);
            const oldStr = typeof input.old_string === "string" ? input.old_string : "";
            const newStr = typeof input.new_string === "string" ? input.new_string : "";
            const oldLines = oldStr ? oldStr.split("\n").length : 0;
            const newLines = newStr ? newStr.split("\n").length : 0;
            activity.linesAdded += Math.max(0, newLines - oldLines);
            activity.linesRemoved += Math.max(0, oldLines - newLines);
            break;
          }
          case "Write": {
            activity.filesModified.add(filePathStr);
            activity.writeCount++;
            filesModified.push(fileName);
            const writeContent = typeof input.content === "string" ? input.content : "";
            activity.linesAdded += writeContent ? writeContent.split("\n").length : 0;
            break;
          }
          case "Glob":
          case "Grep":
            break;
        }
      }

      const tokenUsage: TokenUsage = {
        inputTokens: usage.input_tokens || 0,
        outputTokens: usage.output_tokens || 0,
        cacheCreationTokens: usage.cache_creation_input_tokens || 0,
        cacheReadTokens: usage.cache_read_input_tokens || 0,
      };

      // If no new user prompt, this is a tool_result continuation of the previous exchange.
      if (!currentUserPrompt && exchanges.length > 0) {
        const prev = exchanges[exchanges.length - 1];
        prev.tokenUsage.inputTokens += tokenUsage.inputTokens;
        prev.tokenUsage.outputTokens += tokenUsage.outputTokens;
        prev.tokenUsage.cacheCreationTokens += tokenUsage.cacheCreationTokens;
        prev.tokenUsage.cacheReadTokens += tokenUsage.cacheReadTokens;
        prev.estimatedCostUSD += calculateCost(tokenUsage, model);
        for (const t of toolsUsed) {
          if (!prev.toolsUsed.includes(t)) prev.toolsUsed.push(t);
        }
        for (const f of filesRead) {
          if (!prev.filesRead.includes(f)) prev.filesRead.push(f);
        }
        for (const f of filesModified) {
          if (!prev.filesModified.includes(f)) prev.filesModified.push(f);
        }
        prev.category = classifyExchange(prev.toolsUsed);
        continue;
      }

      const category = classifyExchange(toolsUsed);

      exchanges.push({
        sequenceNumber: sequenceNumber++,
        userPrompt: currentUserPrompt,
        tokenUsage,
        estimatedCostUSD: calculateCost(tokenUsage, model),
        model,
        toolsUsed,
        filesRead,
        filesModified,
        timestamp: msg.timestamp ? new Date(msg.timestamp) : new Date(),
        category,
      });

      currentUserPrompt = "";
    }
  }

  return { exchanges, gitBranch, activity, firstRawPrompt };
}

function classifyExchange(toolsUsed: string[]): ExchangeCategory {
  return classifyExchangeCategory(toolsUsed);
}
