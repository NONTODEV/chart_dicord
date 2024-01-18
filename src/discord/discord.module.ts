import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { DiscordService } from './discord.service';
import { LogEntry, LogEntrySchema } from './schema/log-entry.schema';
import { LogLeave, LogLeaveSchema } from './schema/log-leave.schema';
import { UserTotalTime, UserTotalTimeSchema } from './schema/user-total-tiem.schema';
import { VoiceEvent, VoiceEventSchema } from './schema/event-in-voice-chat.schema';
import { CronUserTotalTime ,CronUserTotalTimeSchema } from './schema/cron-totol-time.schema';
import { DiscordConfig, DiscordConfigSchema } from './schema/server-config-schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: LogEntry.name, schema: LogEntrySchema },
      { name: LogLeave.name, schema: LogLeaveSchema },
      { name: UserTotalTime.name, schema: UserTotalTimeSchema },
      { name: VoiceEvent.name, schema: VoiceEventSchema },
      { name: CronUserTotalTime.name, schema: CronUserTotalTimeSchema },
      { name: DiscordConfig.name, schema: DiscordConfigSchema },
    ]),
  ],
  providers: [DiscordService],
})
export class DiscordModule {}
