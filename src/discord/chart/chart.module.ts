import { Module, DynamicModule } from '@nestjs/common';
import { ChartService } from './chart.service';
import { Client } from 'discord.js';

@Module({
  providers: [ChartService],
  exports: [ChartService],
})
export class ChartModule {
  static forRoot(discordClientProvider: { provide: string; useValue: Client }): DynamicModule {
    return {
      module: ChartModule,
      providers: [discordClientProvider],
      exports: [ChartService],
      global: true, 
    };
  }
}
