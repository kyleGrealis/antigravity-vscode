export interface AgyInitEvent {
  cwd: string;
  tools: string[];
  permission_mode: string;
}

export interface AgyUsage {
  input_tokens?: number;
  output_tokens?: number;
  thinking_tokens?: number;
  cache_read_tokens?: number;
  total_tokens?: number;
}

export interface AgyStepUpdate {
  conversation_id: string;
  step_index: number;
  state: 'DONE' | 'RUNNING' | 'ERROR';
  step_type: 'user_input' | 'agent_response' | 'tool_call' | 'thinking' | 'checkpoint' | string;
  text_delta?: string;
  duration_seconds?: number;
  usage?: AgyUsage;
  tool_name?: string;
  tool_args?: Record<string, any>;
}

export interface AgyResult {
  conversation_id: string;
  status: 'SUCCESS' | 'ERROR' | 'CANCELLED';
  response?: string;
  duration_seconds?: number;
  num_turns?: number;
  usage?: AgyUsage;
}

export interface AgyStreamEvent {
  event: 'init' | 'step_update' | 'result' | 'error';
  init?: AgyInitEvent;
  step_update?: AgyStepUpdate;
  result?: AgyResult;
  error?: string;
  conversation_id?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  thinking?: string;
  timestamp: number;
  tokens?: AgyUsage;
  isStreaming?: boolean;
  toolCalls?: Array<{
    name: string;
    args?: Record<string, any>;
    status?: 'running' | 'done' | 'error';
  }>;
}
