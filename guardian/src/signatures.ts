// Guardian: Input signature extraction for contextual approval learning

export interface SignatureResult {
  signature: string;
  description: string;
}

export function extractSignature(
  toolName: string,
  toolInput: Record<string, unknown>
): SignatureResult {
  // Bash: first word of command
  if (toolName === "Bash" && typeof toolInput.command === "string") {
    const firstWord = toolInput.command.trim().split(/\s+/)[0];
    return { signature: firstWord, description: `Running ${firstWord} commands` };
  }

  // Write/Edit: file extension from file_path
  if (
    (toolName === "Write" || toolName === "Edit") &&
    typeof toolInput.file_path === "string"
  ) {
    const match = toolInput.file_path.match(/\.(\w+)$/);
    if (match) {
      return { signature: `*.${match[1]}`, description: `Editing .${match[1]} files` };
    }
  }

  // WebFetch: domain from URL
  if (toolName === "WebFetch" && typeof toolInput.url === "string") {
    try {
      const domain = new URL(toolInput.url).hostname;
      return { signature: domain, description: `Fetching from ${domain}` };
    } catch { /* fall through to default */ }
  }

  // MCP tools: extract server name and action
  // Format: mcp__servername__action_name
  const mcpMatch = toolName.match(/^mcp__([^_]+)__(.+)$/);
  if (mcpMatch) {
    const [, server, action] = mcpMatch;
    const readableAction = action.replace(/_/g, " ");
    return {
      signature: `${server}/${action}`,
      description: `${readableAction} via ${server}`,
    };
  }

  // Default: tool name itself
  return { signature: toolName, description: `Using ${toolName}` };
}
