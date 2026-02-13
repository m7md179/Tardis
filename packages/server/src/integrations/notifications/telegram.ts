import { ServerConfig } from '../../config';
export class TelegramNotifier {
  private botToken: string;
  private chatId: string;

  constructor(config: ServerConfig) {
    const telegram = config.notifications.channels.telegram;

    if (!telegram?.botToken || !telegram.chatId) {
      throw new Error('Telegram credentials not configured');
    }

    this.botToken = telegram.botToken;
    this.chatId = telegram.chatId;
  }

  async send(message: string) {
    try {
      const response = await fetch(`https://api.telegram.org/bot${this.botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: this.chatId,
          text: message,
          parse_mode: 'Markdown',
        }),
      });

      if (!response.ok) {
        throw new Error(`Telegram API error: ${response.statusText}`);
      }

      console.log('Telegram notification sent');
    } catch (error) {
      console.error('Failed to send Telegram notification:', error);
      throw error;
    }
  }
}
