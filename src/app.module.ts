import { Module, OnModuleInit } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DiscordModule } from './discord/discord.module';
import { MongooseModule } from '@nestjs/mongoose';
import { mongodb } from '../config.json';
import { ChartModule } from './discord/chart/chart.module';
import { Client, GatewayIntentBits } from 'discord.js';

@Module({
  imports: [
    DiscordModule,
    MongooseModule.forRoot(mongodb),
    ChartModule.forRoot({
      provide: 'DiscordClient',
      useValue: new Client({
        intents: [
          GatewayIntentBits.Guilds,
          GatewayIntentBits.GuildMessages,
          GatewayIntentBits.GuildVoiceStates,
        ],
      }),
    }),
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule implements OnModuleInit {
  onModuleInit() {
    console.log('Connected to MongoDB successfully');
  }
}