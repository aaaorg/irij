export type ChatChannel = 'local' | 'global' | 'trade' | 'whisper';

export interface ChatMessage {
  channel: ChatChannel;
  text: string;
  target?: string; // player_id pro whisper
}

export interface ChatBroadcast {
  channel: ChatChannel;
  sender_id: string;
  sender_display_name: string;
  text: string;
  server_time: string;
}

export interface RegionalBroadcast {
  region: string;
  message_id: string;
  text: string;
}
