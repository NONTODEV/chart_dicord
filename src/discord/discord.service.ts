import { Injectable, Logger } from '@nestjs/common';
import * as Discord from 'discord.js';
import { REST, Routes, TextChannel } from 'discord.js';
import { token, serverId, channelIds, clientBotId } from '../../config.json';
import * as dayjs from 'dayjs';
import * as duration from 'dayjs/plugin/duration';
import 'dayjs/plugin/timezone';
import 'dayjs/plugin/utc';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { LogEntry, LogEntrySchema } from './schema/log-entry.schema';
import { LogLeave, LogLeaveSchema } from './schema/log-leave.schema';
import { UserTotalTime, UserTotalTimeSchema } from './schema/user-total-tiem.schema';
import { checkDevice } from './components/devices/get-device';
import { VoiceEvent, VoiceEventSchema } from './schema/event-in-voice-chat.schema';
import { formatTotalTime } from './components/utils/format-total-time';
import * as cron from 'node-cron';
import { CronUserTotalTime, CronUserTotalTimeSchema } from './schema/cron-totol-time.schema';
import { joinVoiceChannel, VoiceConnectionStatus, getVoiceConnection, VoiceConnection } from '@discordjs/voice';
import { DiscordConfig, DiscordConfigSchema } from './schema/server-config-schema';
import { formatSpeakingTime } from './components/utils/format-speaking-time';
import { ChartService } from './chart/chart.service';
import * as canvas from 'canvas';
import { ChartJSNodeCanvas } from 'chartjs-node-canvas';


dayjs.extend(duration);
dayjs.extend(require('dayjs/plugin/timezone'));
dayjs.extend(require('dayjs/plugin/utc'));


@Injectable()
export class DiscordService {
  [x: string]: any;
  private readonly client: Discord.Client;
  private userTimeMap: Map<string, { joinTime: string }> = new Map();
  private totalTimes: Map<string, number> = new Map();
  private voiceConnection: VoiceConnection | null = null;
  private speakingStartTime: Date | null = null;
  private rest: REST;

  constructor(
    @InjectModel(LogEntry.name) private readonly logEntryModel: Model<LogEntry>,
    @InjectModel(LogLeave.name) private readonly logLeaveModel: Model<LogLeave>,
    @InjectModel(UserTotalTime.name) private readonly userTotalTimeModel: Model<UserTotalTime>,
    @InjectModel(VoiceEvent.name) private readonly voiceEventModel: Model<UserTotalTime>,
    @InjectModel(CronUserTotalTime.name) private readonly cronUserTotalTime: Model<CronUserTotalTime>,
    @InjectModel(DiscordConfig.name) private readonly discordConfigModel: Model<DiscordConfig>,

  ) {

    this.client = new Discord.Client({
      intents: [
        Discord.GatewayIntentBits.GuildMessages,
        Discord.GatewayIntentBits.GuildMembers,
        Discord.GatewayIntentBits.DirectMessages,
        Discord.GatewayIntentBits.MessageContent,
        Discord.GatewayIntentBits.Guilds,
        Discord.GatewayIntentBits.GuildVoiceStates,
        Discord.GatewayIntentBits.GuildPresences,
      ],
      partials: [
        Discord.Partials.Message,
        Discord.Partials.Channel,
        Discord.Partials.GuildMember,
        Discord.Partials.User,
        Discord.Partials.GuildScheduledEvent,
        Discord.Partials.ThreadMember,
      ],
    });

    this.client.once('ready', (client) => {
      console.log('Bot ' + client.user.tag + ' is now online!');
      this.rest = new REST({ version: '10' }).setToken(token);
      this.registerCommands();
    });

    this.client.on('guildCreate', async (guild) => {
      const guildId = guild.id;
      const newState = { guild: guild };
      this.handleGuildJoin(guildId, newState);
    });

    this.client.on('messageCreate', async (message) => {
      try {
        const lowerCaseContent = message.content.toLowerCase();
        if (lowerCaseContent.startsWith('/check')) {
          await this.sendUserTotalTime(message);
          console.log('send message successfully!')
        }
      } catch (error) {
        console.error('Error handling messageCreate event:', error);
      }
    });

    this.client.on('interactionCreate', (interaction) => {
      if (!interaction.isCommand()) return;
      this.handleCommand(interaction);
    });

    this.setupEventHandlers();
    this.setupCronJobs.bind(this)();
    this.client.login(token);
  }

  private setupCronJobs() {
    cron.schedule('20 28 14 * * *', async () => {
      try {
        await this.sendUserTotalTimeToAllChannels();
      } catch (error) {
        console.error('Error running cron job:', error.message);
      }
    });
  }

  private async setupEventHandlers() {
    let intervalId: NodeJS.Timeout | null = null;
    this.client.on('voiceStateUpdate', async (oldState, newState) => {
      try {
        const guild = await newState.guild.members.fetch(newState.member.user.id);
        const updatedState = {
          ...newState,
          member: guild,
        };

        const voiceChannelId = channelIds.voiceChannel;

        if (updatedState.channelId === voiceChannelId && updatedState.guild.id === serverId) {
          const isFirstUserInVoiceChannel = (updatedState.guild.channels.cache.get(updatedState.channelId) as Discord.VoiceChannel)?.members.size === 1;

          if (!this.userTimeMap.has(updatedState.member.id)) {
            const entry = {
              username: updatedState.member.user.username,
              userId: updatedState.member.id,
              action: 'join',
              timestamp: dayjs().tz('Asia/Bangkok').format(),
            };

            await this.logEntry(updatedState, entry);
            this.userTimeMap.set(updatedState.member.id, { joinTime: entry.timestamp });
          }

          await this.handleVoiceEvents(newState, oldState);

          if (isFirstUserInVoiceChannel) {
            const voiceChannel = updatedState.guild.channels.cache.get(voiceChannelId) as Discord.VoiceChannel;
            let isSpeaking = false;
            try {
              if (this.voiceConnection && !this.voiceConnection.joinConfig.channelId) {
                console.log(`Bot has been destroyed. Stopping further actions.`);
                return;
              }

              const connection = joinVoiceChannel({
                channelId: voiceChannel.id,
                guildId: voiceChannel.guild.id,
                adapterCreator: voiceChannel.guild.voiceAdapterCreator,
                selfDeaf: false,
                selfMute: true,
              });

              connection.on(VoiceConnectionStatus.Ready, async () => {
                console.log(`Bot joined voice channel: ${voiceChannel.name}`);
                isSpeaking = false;

                connection.receiver.speaking.on('start', async (userId) => {
                  isSpeaking = true;

                  if (this.voiceConnection && !this.voiceConnection.joinConfig.channelId) {
                    console.log(`Bot has been destroyed. Stopping further actions.`);
                    return;
                  }

                  const user = await voiceChannel.guild.members.fetch(userId);
                  console.log(`${user.user.username} started speaking.`);
                  this.speakingStartTime = new Date();
                });

                connection.receiver.speaking.on('end', async (userId) => {
                  isSpeaking = false;

                  const user = await voiceChannel.guild.members.fetch(userId);
                  console.log(`${user.user.username} stopped speaking.`);

                  if (this.speakingStartTime) {
                    const speakingEndTime = new Date();
                    const speakingDuration = speakingEndTime.getTime() - this.speakingStartTime.getTime();

                    const userTotalTime = this.totalTimes.get(userId) || 0;
                    this.totalTimes.set(userId, userTotalTime + speakingDuration);

                    const adjustedDuration = speakingDuration < 1000 ? 1000 : speakingDuration;

                    const currentDate = new Date();
                    const currentDateStr = `${currentDate.getFullYear()}-${currentDate.getMonth() + 1}-${currentDate.getDate()}`;

                    const query = {
                      discordId: userId,
                      discordName: user.user.username,
                      serverName: voiceChannel.guild.name,
                      createdAt: new Date(currentDateStr)
                    };

                    const update = {
                      $inc: {
                        'sPeakingTime.hours': Math.floor(adjustedDuration / (60 * 60 * 1000)),
                        'sPeakingTime.minutes': Math.floor(adjustedDuration / (60 * 1000)) % 60,
                        'sPeakingTime.seconds': Math.floor(adjustedDuration / 1000) % 60,
                      },
                    };

                    const options = { upsert: true, setDefaultsOnInsert: true };

                    const userTotalTimeData = await this.userTotalTimeModel.findOneAndUpdate(query, update, options);

                    if (!userTotalTimeData) {
                      console.log(`${user.user.username} spoke for ${adjustedDuration} milliseconds. Created new document.`);
                    } else {
                      console.log(`${user.user.username} spoke for ${adjustedDuration} milliseconds. Updated total speaking time.`);
                    }
                  }

                  this.speakingStartTime = null;
                });
              });

            } catch (error) {
              console.error(`Error joining voice channel: ${voiceChannel.name}`, error);
            }
          }
        } else if (oldState.channelId === voiceChannelId) {
          if (!newState.channelId || newState.channelId !== voiceChannelId) {
            const entry = {
              username: oldState.member.user.username,
              userId: oldState.member.id,
              action: 'leave',
              timestamp: dayjs().tz('Asia/Bangkok').format(),
            };
            await this.logLeave(oldState, entry);

            const voiceChannel = oldState.guild.channels.cache.get(voiceChannelId) as Discord.VoiceChannel;
            const nonBotMembers = voiceChannel?.members.filter(member => !member.user.bot);
            if (nonBotMembers.size === 0) {
              const connection = getVoiceConnection(voiceChannel.guild.id);
              if (connection) {
                setTimeout(async () => {
                  clearInterval(intervalId);
                  connection.destroy()
                  console.log(`Bot left voice channel due to no non-bot users: ${voiceChannel.name}`);
                }, 3000);
              }
            }
          }
        } else if (oldState.channelId === voiceChannelId) {
          if (!newState.channelId || newState.channelId !== voiceChannelId) {
            const entry = {
              username: oldState.member.user.username,
              userId: oldState.member.id,
              action: 'leave',
              timestamp: dayjs().tz('Asia/Bangkok').format(),
            };
            await this.logLeave(oldState, entry);
          }
        }
      } catch (error) {
        console.error('Error handling voiceStateUpdate event:', error);
      }
    });
  }

  private async handleUserTotalTime(oldState, entry) {
    try {
      if (this.userTimeMap.has(entry.userId)) {
        const joinTime = dayjs(this.userTimeMap.get(entry.userId).joinTime);
        const leaveTime = dayjs(entry.timestamp);
        const duration = dayjs.duration(leaveTime.diff(joinTime));

        const devicesType = await this.getLogEntryDevicesType(entry.userId);

        if (this.totalTimes.has(entry.userId)) {
          this.totalTimes.set(entry.userId, 0);
        }

        const totalTime = duration.asMinutes();
        this.totalTimes.set(entry.userId, totalTime);

        await this.saveTotalTime(entry.userId, entry.username, totalTime, oldState.guild.name, {
          devicesType,
          joinTime: entry.timestamp,
        });
        this.sendTotalTimeMessage(oldState, entry);
      }
    } catch (error) {
      console.error('Error handling user total time:', error.message);
    }
  }

  private async saveTotalTime(userId: string, discordName: string, totalTime: number, serverName: string, totalTimeData) {
    try {
      if (this.client.users.cache.get(userId)?.bot) {
        return;
      }

      const bangkokTime = dayjs().tz('Asia/Bangkok').format();
      const hours = Math.floor(totalTime / 60);
      const minutes = Math.floor(totalTime % 60);
      const seconds = Math.round((totalTime % 1) * 60);

      const existingRecord = await this.userTotalTimeModel.findOne({
        discordId: userId,
        createdAt: {
          $gte: dayjs(bangkokTime).startOf('day').toDate(),
          $lt: dayjs(bangkokTime).endOf('day').toDate(),
        },
      }).lean();

      if (existingRecord) {
        existingRecord.joinMethod = existingRecord.joinMethod || [];
        existingRecord.joinMethod.unshift({
          devicesType: totalTimeData.devicesType,
          totalTime: {
            hours: hours.toString(),
            minutes: minutes.toString(),
            seconds: seconds.toString(),
          },
          joinTime: dayjs().tz('Asia/Bangkok').toDate(),
        });
        existingRecord.serverName = serverName;

        await this.userTotalTimeModel.findByIdAndUpdate(
          existingRecord._id,
          {
            $set: {
              joinMethod: existingRecord.joinMethod,
              serverName: existingRecord.serverName,
            },
          }
        );

        console.log(`Total time for User ${discordName} on ${bangkokTime} on server ${serverName} updated to ${hours} hours, ${minutes} minutes, ${seconds} seconds`);
      } else {
        const totalTimeEntry = new this.userTotalTimeModel({
          discordName,
          discordId: userId,
          joinMethod: [{
            devicesType: totalTimeData.devicesType,
            totalTime: {
              hours: hours.toString(),
              minutes: minutes.toString(),
              seconds: seconds.toString(),
            },
            joinTime: dayjs().tz('Asia/Bangkok').toDate(),
          }],
          createdAt: dayjs(bangkokTime).toDate(),
          serverName,
        });
        await totalTimeEntry.save();
        console.log(`Total time for User ${discordName} on ${bangkokTime} on server ${serverName} saved: ${hours} hours, ${minutes} minutes, ${seconds} seconds`);
      }
    } catch (error) {
      console.error('Error saving total time entry:', error.message);
    }
  }

  private async sendTotalTimeMessage(oldState, entry) {
    try {
      if (channelIds.channeltotaltime) {
        if (this.client.users.cache.get(entry.userId)?.bot) {
          return;
        }
        const totalTimeInMinutes = this.totalTimes.get(entry.userId);
        const hours = Math.floor(totalTimeInMinutes / 60);
        const minutes = Math.floor(totalTimeInMinutes % 60);
        const seconds = Math.round((totalTimeInMinutes % 1) * 60);

        const totalChannel = oldState.guild.channels.cache.get(channelIds.channeltotaltime) as Discord.TextChannel;
        if (totalChannel) {
          const totalTimeMessage = `\`\`\`User ${entry.username} spent a total of ${hours} hours, ${minutes} minutes, ${seconds} seconds in the voice channel.\`\`\``;
          totalChannel.send(totalTimeMessage);
        } else {
          console.error(`Error: Channel with ID ${channelIds.channeltotaltime} not found.`);
        }
      }
    } catch (error) {
      console.error('Error sending total time message:', error.message);
    }
  }

  private sendLogMessage(channelId: string, message: string) {
    const channel = this.client.guilds.cache.get(serverId).channels.cache.get(channelId) as Discord.TextChannel;
    if (channel) {
      channel.send(`\`\`\`${message}\`\`\``);
    }
  }

  private async getLogEntryDevicesType(userId: string): Promise<string> {
    try {
      const latestLogEntry = await this.logEntryModel.findOne({ userId }).sort({ timestamp: -1 });
      return latestLogEntry?.devicesType || '';
    } catch (error) {
      console.error('Error getting LogEntry devicesType:', error.message);
      return '';
    }
  }

  private async logEntry(newState, entry) {
    try {
      if (this.client.users.cache.get(entry.userId)?.bot) {
        return;
      }

      if (!newState.guild) {
        console.error('Error logging entry: Guild information not available.');
        return;
      }

      const devices = checkDevice(newState, channelIds.voiceChannel);

      if (!devices) {
        console.error('Error logging entry: Device information not available.');
        return;
      }

      const timestamp = dayjs(entry.timestamp);
      if (!timestamp.isValid()) {
        console.error('Error logging entry: Invalid timestamp format.');
        return;
      }

      const logEntry = new this.logEntryModel({
        ...entry,
        timestamp: timestamp.tz('Asia/Bangkok').toDate(),
        serverName: newState.guild.name,
        devicesType: devices,
      });

      await logEntry.save();
      console.log('User join event saved to MongoDB:', logEntry);

      const message = `User ${entry.username} joined the voice channel at ${logEntry.timestamp} on server ${newState.guild.name} using ${devices}`;
      this.sendLogMessage(channelIds.channelenter, message);

      this.userTimeMap.set(entry.userId, { joinTime: entry.timestamp });
    } catch (error) {
      console.error('Error logging entry:', error.message);
    }
  }

  private async logUserEvent(userId: string, username: string, event: string) {
    try {
      if (this.client.users.cache.get(userId)?.bot) {
        return;
      }

      const timestamp = dayjs().tz('Asia/Bangkok').toDate();
      const today = dayjs().tz('Asia/Bangkok').startOf('day').toDate();

      const voiceEvent = await this.voiceEventModel.findOneAndUpdate(
        { userId, username, 'events.timestamp': { $gte: today } },
        {
          $addToSet: {
            events: {
              $each: [{
                event,
                timestamp,
              }],
            },
          },
        },
        { upsert: true, new: true }
      );
      console.log(`User ${username} ${event} at ${timestamp}`);
    } catch (error) {
      console.error('Error logging user event:', error.message);
    }
  }

  private async logLeave(oldState, entry) {
    try {
      if (this.client.users.cache.get(entry.userId)?.bot) {
        return;
      }

      const logLeave = new this.logLeaveModel({
        ...entry,
        timestamp: dayjs(entry.timestamp).tz('Asia/Bangkok').toDate(),
        serverName: oldState.guild.name,
      });

      await logLeave.save();
      console.log('User leave event saved to MongoDB:', logLeave);

      const message = `User ${entry.username} left the voice channel at ${logLeave.timestamp} on server ${oldState.guild.name}`;
      this.sendLogMessage(channelIds.channelleave, message);

      this.handleUserTotalTime(oldState, entry);
      this.userTimeMap.delete(entry.userId);
    } catch (error) {
      console.error('Error logging leave entry:', error.message);
    }
  }

  private async sendUserTotalTime(message: Discord.Message) {
    try {
      const userId = message.author.id;

      if (!userId) {
        message.reply('Please mention a user.');
        return;
      }

      const today = dayjs().tz('Asia/Bangkok').startOf('day').toDate();

      const userTotalTime = await this.userTotalTimeModel.findOne({
        discordId: userId,
        createdAt: { $gte: today },
      }).exec();

      if (!userTotalTime) {
        message.reply('User total time not found.');
        return;
      }

      const { formattedDevicesInfo, formattedTotalTime } = this.calculateTotalTime(userTotalTime, today);
      const formattedSpeakingTime = formatSpeakingTime(userTotalTime.sPeakingTime);
      const channelId = channelIds.channelsendtotaltime;
      const channel = this.client.channels.cache.get(channelId) as Discord.TextChannel;

      if (!channel) {
        message.reply(`Error: Channel with ID ${channelId} not found.`);
        return;
      }

      const totalTimeMessage = `\`\`\`Total time for ${userTotalTime.discordName} on ${userTotalTime.createdAt}: ${formattedTotalTime}\nDevices Used:\n${formattedDevicesInfo.join('\n')}\nSpeaking Time: ${formattedSpeakingTime}\`\`\``;
      await channel.send(totalTimeMessage);
    } catch (error) {
      console.error('Error sending user total time:', error);
      message.reply('An error occurred while sending user total time.');
    }
  }

  private async sendTotalTimeToChannel(channel: Discord.TextChannel, userId: string, today: Date) {
    try {
      const userTotalTime = await this.userTotalTimeModel.findOne({
        discordId: userId,
        createdAt: { $gte: today },
      }).exec();

      if (!userTotalTime) {
        console.log(`User total time not found for user ID ${userId}.`);
        return;
      }

      const { formattedDevicesInfo, formattedTotalTime } = this.calculateTotalTime(userTotalTime, today);
      const formattedSpeakingTime = formatSpeakingTime(userTotalTime.sPeakingTime);

      const totalTimeMessage = `\`\`\`Total time for ${userTotalTime.discordName} on ${userTotalTime.createdAt}: ${formattedTotalTime}\nDevices Used:\n${formattedDevicesInfo.join('\n')}\nSpeaking Time: ${formattedSpeakingTime}\`\`\``;
      await channel.send(totalTimeMessage);
    } catch (error) {
      console.error(`Error sending user total time for user ID ${userId}:`, error.message);
    }
  }

  private async sendUserTotalTimeToAllChannels() {
    try {
      const channelId = channelIds.channelsendtotaltime;
      const channel = this.client.channels.cache.get(channelId) as Discord.TextChannel;

      if (!channel) {
        console.error(`Error: Channel with ID ${channelId} not found.`);
        return;
      }

      const today = dayjs().tz('Asia/Bangkok').startOf('day').toDate();

      for (const [userId, user] of this.client.users.cache) {
        await this.sendTotalTimeToChannel(channel, userId, today);

        await this.saveCronUserTotalTime(userId, user.username, user.id, user.createdAt, today);
      }
    } catch (error) {
      console.error('Error sending user total time to all channels:', error.message);
    }
  }

  private calculateTotalTime(userTotalTime: UserTotalTime, today: Date) {
    const devicesInfo: Record<string, number[]> = {};
    let totalDayTime = 0;

    for (const joinMethod of userTotalTime.joinMethod) {
      const joinTime = new Date(joinMethod.joinTime);
      if (joinTime.toDateString() === today.toDateString()) {
        totalDayTime += parseInt(joinMethod.totalTime.hours) * 3600;
        totalDayTime += parseInt(joinMethod.totalTime.minutes) * 60;
        totalDayTime += parseInt(joinMethod.totalTime.seconds);
        const totalTimeInSeconds =
          parseInt(joinMethod.totalTime.hours) * 3600 +
          parseInt(joinMethod.totalTime.minutes) * 60 +
          parseInt(joinMethod.totalTime.seconds);
        if (devicesInfo[joinMethod.devicesType]) {
          devicesInfo[joinMethod.devicesType].push(totalTimeInSeconds);
        } else {
          devicesInfo[joinMethod.devicesType] = [totalTimeInSeconds];
        }
      }
    }

    const formattedDevicesInfo: string[] = [];
    for (const deviceType in devicesInfo) {
      const totalDeviceTime = devicesInfo[deviceType].reduce((acc, curr) => acc + curr, 0);
      formattedDevicesInfo.push(`${deviceType} = ${formatTotalTime(totalDeviceTime)}`);
    }

    const formattedTotalTime = formatTotalTime(totalDayTime);

    return {
      formattedDevicesInfo,
      formattedTotalTime,
    };
  }

  private async saveCronUserTotalTime(userId: string, discordName: string, discordId: string, createdAt: Date, today: Date) {
    try {
      const userTotalTime = await this.userTotalTimeModel.findOne({
        discordId: userId,
        createdAt: { $gte: today },
      }).exec();

      if (!userTotalTime) {
        console.log(`User total time not found for user ID ${userId}.`);
        return;
      }

      const { formattedDevicesInfo, formattedTotalTime } = this.calculateTotalTime(userTotalTime, today);
      const formattedSpeakingTime = formatSpeakingTime(userTotalTime.sPeakingTime);
      const joinMethod = formattedDevicesInfo.map(deviceInfo => {
        const [devicesType, time] = deviceInfo.split('=').map(info => info.trim());
        const [hours, minutes, seconds] = time.split(':').map(unit => unit.trim());
        return {
          devicesType,
          totalTime: { hours, minutes, seconds },
        };
      });
      const cronUserTotalTimeEntry = new this.cronUserTotalTime({
        discordName,
        userId,
        serverName: userTotalTime.serverName,
        totalTime: formattedTotalTime,
        sPeakingTime: formattedSpeakingTime,
        joinMethod,
        createdAt: new Date(),
      });
      await cronUserTotalTimeEntry.save();
      console.log(`Cron user total time entry saved for User ${discordName} on ${createdAt}`);
    } catch (error) {
      console.error('Error saving cron user total time entry:', error.message);
    }
  }


  private async handleVoiceEvents(newState, oldState) {
    if (oldState.selfDeaf !== newState.selfDeaf && newState.channelId === channelIds.voiceChannel) {
      await this.logUserEvent(newState.member.id, newState.member.user.username, newState.selfDeaf ? 'Deaf' : 'Undeaf');
    }

    if (oldState.selfMute !== newState.selfMute && newState.channelId === channelIds.voiceChannel) {
      await this.logUserEvent(newState.member.id, newState.member.user.username, newState.selfMute ? 'Mute' : 'Unmute');
    }

    if (oldState.streaming !== newState.streaming && newState.channelId === channelIds.voiceChannel) {
      await this.logUserEvent(newState.member.id, newState.member.user.username, newState.streaming ? 'Start Streaming' : 'Stop Streaming');
    }

    if (oldState.selfVideo !== newState.selfVideo && newState.channelId === channelIds.voiceChannel) {
      await this.logUserEvent(newState.member.id, newState.member.user.username, newState.selfVideo ? 'Start Sharing Video' : 'Stop Sharing Video');
    }

    if (oldState.deaf !== newState.deaf && newState.channelId === channelIds.voiceChannel) {
      await this.logUserEvent(newState.member.id, newState.member.user.username, newState.deaf ? 'Server Deaf' : 'Server Undeaf');
    }
  }

  private async handleGuildJoin(guildId: string, newState) {
    try {
      const serverName = newState.guild.name;
  
      let existingConfig = await this.discordConfigModel.findOne({ discordServerId: guildId });
  
      if (!existingConfig) {
        const newConfig = new this.discordConfigModel({
          discordServerId: guildId,
          discordServerName: serverName,
          channelId: [
            {
              voiceChannel: 'none',
              channelEnter: 'none',
              channelLeave: 'none',
              channelTotaltime: 'none',
              channelCronTotaltime: 'none',
              channelSendChart: 'none',
            },
          ],
        });
  
        await newConfig.save();
        console.log(`Bot joined a new server. Server ID: ${guildId}, Server Name: ${serverName}`);
      } else {
        if (existingConfig.channelId.length === 0) {
          existingConfig.channelId.push({
            voiceChannel: 'none',
            channelEnter: 'none',
            channelLeave: 'none',
            channelTotaltime: 'none',
            channelCronTotaltime: 'none',
            channelSendChart: 'none',
          });
          await existingConfig.save();
        }
  
        existingConfig.discordServerId = guildId;
        console.log(`Bot rejoined an existing server. Server ID: ${guildId}, Server Name: ${serverName}`);
      }
    } catch (error) {
      console.error('Error handling guild join:', error);
    }
  }

    // find id server

    async findGuildIdByServerId(discordServerId: string): Promise<string | null> {
      const config = await this.discordConfigModel.findOne({ discordServerId });
      return config ? config.discordServerId : null;
    }
  
    // ---------------------------------------------------------------------------------------------------------------------------
  
  
  private async updateChannelId(guildId: string, newChannelId: {
    voiceChannel: string;
    channelEnter: string;
    channelLeave: string;
    channelTotaltime: string;
    channelCronTotaltime: string;
    channelSendChart: string;
  }[]) {
    try {
      const existingConfig = await this.discordConfigModel.findOne({ discordServerId: guildId });
  
      if (existingConfig) {
        existingConfig.channelId = newChannelId;
  
        await existingConfig.save();
        console.log(`Channel ID updated for server. Server ID: ${guildId}`);
      } else {
        console.error(`Config not found for server. Server ID: ${guildId}`);
      }
    } catch (error) {
      console.error('Error updating channel ID:', error);
    }
  }

  private async registerCommands() {
    const commands = [
      {
        name: 'help',
        description: 'Get help from the bot',
      },
      {
        name: 'voicechannel',
        description: 'Set your voice channel',
        options: [
          {
            name: 'voice_channel',
            description: 'Select a voice channel',
            type: Discord.ApplicationCommandOptionType.Channel,
            channelTypes: [Discord.ChannelType.GuildVoice],
            require: true,
          },
        ],
      },
      {
        name: 'sentchart',
        description: 'Send the chart data to a specific channel',
      },
      {
        name: 'sentchartuser',
        description: 'Send the chart data for a specific user to a channel',
        options: [
          {
            name: 'user',
            description: 'Select a user',
            type: Discord.ApplicationCommandOptionType.User,
            require: true,
          },
        ],
      },
    ];   
  
    try {
      console.log('Started refreshing application (/) commands.');
  
      this.client.on('messageCreate', async (message) => {
        const interaction = message;
  
        const discordServerId = interaction?.guildId;
  
        if (discordServerId) {
          const foundServerId = await this.findGuildIdByServerId(discordServerId);
  
          if (foundServerId) {
            await this.rest.put(
              Routes.applicationGuildCommands(clientBotId , foundServerId),
              { body: commands },
            );
  
            console.log(`Successfully reloaded application (/) commands for Guild ID: ${foundServerId}`);
          } else {
            console.error(`Discord Server ID not found: ${discordServerId}`);
          }
        } else {
          console.error('Unable to determine Discord Server ID from the interaction.');
        }
      });
    } catch (error) {
      console.error(error);
    }
  }
  
  private async handleCommand(interaction) {
    const command = interaction.commandName;
  
    if (interaction.deferred || interaction.replied) {
      console.error('Interaction is already deferred or replied.');
      return;
    }
  
    if (command === 'help') {
      try {
        const embedMessage = {
          color: 0x0099ff,
          title: 'Help Command',
          description: 'Your help message goes here!',
          fields: [
            {
              name: '/voicechannel',
              value: 'set_voice_channel',
            },
            {
              name: '/textchannel',
              value: 'set_text_channel',
            },
            {
              name: '/sentchart',
              value: 'sent_chart_channel',
            },
          ],
          timestamp: new Date(),
          footer: {
            text: "Bot",
          },
        };
  
        await interaction.reply({ embeds: [embedMessage] });
      } catch (error) {
        console.error('Error replying to interaction:', error);
      }
    }  if (command === 'voicechannel') {
      try {
        const selectedVoiceChannel = interaction.options.get('voice_channel');
        const channelName = selectedVoiceChannel?.value;
  
        if (channelName) {
          await interaction.reply(`คุณได้ทำการเลือก ${channelName}`);
        } else {
          await interaction.reply('เกิดข้อผิดพลาดในการเลือก voice channel');
        }
      } catch (error) {
        console.error('Error handling set command:', error);
      }
    }  if (command === 'sentchart') {
      try {
        const chartService = new ChartService(); 
        const chartData = await chartService.generateChartFromMongoData();  
        const channelId = (channelIds.channelsendchart);
        const channel = interaction.guild.channels.cache.get(channelId);
  
        if (channel instanceof TextChannel) {
          await channel.send({ files: [ { attachment: chartData, name: 'chart.png' } ] });
          await interaction.reply('Chart data sent successfully!');
        } else {
          await interaction.reply('Unable to send chart data. Channel not found or not a text channel.');
        }
      } catch (error) {
        console.error('Error handling sentchart command:', error);
      }
      if (command === 'sentchartuser') {
        try {
          const selectedUser = interaction.options.get('user');
          const userId = selectedUser?.id;
      
          if (userId) {
            const chartService = new ChartService();
            const userData = await chartService.getDataFromMongo(); 
            const chartData = await chartService.generateChartForUser(userData[0]); 
            const channelId = (channelIds.channelsendchart);
            const channel = interaction.guild.channels.cache.get(channelId);
      
            if (channel instanceof TextChannel) {
              await channel.send({ files: [{ attachment: chartData, name: 'chart.png' }] });
              await interaction.reply('Chart data for the user sent successfully!');
            } else {
              await interaction.reply('Unable to send chart data. Channel not found or not a text channel.');
            }
          } else {
            await interaction.reply('Invalid user selection.');
          }
        } catch (error) {
          console.error('Error handling sentchartuser command:', error);
        }
      }
    }
  }
}
