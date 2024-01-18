import * as Discord from 'discord.js';

export function checkDevice(newState: Discord.VoiceState, channelId: string): string | null {
  const devices: string[] = [];

  const user = newState.member?.user;

  if (!user || !newState.guild) {
    console.error('Error logging entry: Guild or user information not available.');
    return null;
  }

  const guildMember = newState.guild.members.cache.get(user.id);

  if (!guildMember) {
    console.error('Error logging entry: Guild member information not available.');
    return null;
  }

  const presence = guildMember.presence;

  if (!presence) {
    console.error('Error logging entry: Presence information not available.');
    return null;
  }

  const clientStatus = presence.clientStatus;

  if (!clientStatus) {
    console.error('Error logging entry: Client status information not available.');
    return null;
  }

  if (newState.channelId === channelId) {
    if (clientStatus.desktop) {
      devices.push('desktop');
    }

    if (clientStatus.web) {
      devices.push('web');
    }

    if (clientStatus.mobile) {
      devices.push('mobile');
    }
  }

  return devices.length > 0 ? devices.join(', ') : null;
}