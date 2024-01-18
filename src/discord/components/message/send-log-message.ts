import * as Discord from 'discord.js';
import { serverId } from '../../../../config.json';

export function sendLogMessage(channelId: string, message: string) {
    const channel = this.client.guilds.cache.get(serverId).channels.cache.get(channelId) as Discord.TextChannel;
    if (channel) {
      channel.send(`\`\`\`${message}\`\`\``);
    }
  }