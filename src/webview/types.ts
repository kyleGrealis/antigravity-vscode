export interface ToolCall {
  id?: string | number;
  name: string;
  args?: Record<string, any> | string;
  result?: string;
  status?: 'running' | 'done' | 'error';
  expanded?: boolean;
}

export type MessageContentBlock =
  | { type: 'text'; text: string }
  | { type: 'toolCalls'; tools: ToolCall[] };

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  thinking?: string;
  tokens?: {
    input_tokens?: number;
    output_tokens?: number;
    thinking_tokens?: number;
    total_tokens?: number;
  };
  toolCalls?: ToolCall[];
  blocks?: MessageContentBlock[];
  isStreaming?: boolean;
  plan?: any;
  clarification?: any;
  isPlanMode?: boolean;
}

export interface SlashOption {
  value: string;
  label: string;
}

export interface SlashCommand {
  name: string;
  description: string;
  hasArg?: boolean;
  argHint?: string;
  isSkill?: boolean;
  options?: SlashOption[];
}

export interface SlashDisplayItem {
  name: string;
  displayName: string;
  description: string;
  hasArg?: boolean;
  isSkill?: boolean;
  insertValue?: string;
}
