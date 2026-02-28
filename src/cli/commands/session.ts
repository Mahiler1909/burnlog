import { ClaudeCodeProvider } from "../../providers/claude-code/provider.js";
import { renderSessionDetail } from "../formatters/table.js";

export async function sessionCommand(sessionId: string): Promise<void> {
  const provider = new ClaudeCodeProvider();
  const allSessions = await provider.loadAllSessions();

  // Find session by full ID or prefix match
  const session = allSessions.find(
    (s) => s.id === sessionId || s.id.startsWith(sessionId),
  );

  if (!session) {
    console.log(`Session not found: ${sessionId}`);
    console.log("Use 'burnlog sessions' to list available sessions.");
    return;
  }

  renderSessionDetail(session);
}
