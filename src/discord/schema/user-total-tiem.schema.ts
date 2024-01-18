import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema()
export class UserTotalTime extends Document {
  @Prop()
  discordName: string;

  @Prop()
  discordId: string;

  @Prop()
  serverName: string;

  @Prop({ default: Date.now })
  createdAt: Date;

  @Prop()
  sPeakingTime: Array<{
      hours: string;
      minutes: string;
      seconds: string;
  }>;
  
  @Prop([
    {
      devicesType: String,
      totalTime: {
        hours: { type: String, required: true },
        minutes: { type: String, required: true },
        seconds: { type: String, required: true },
      },
      joinTime: Date,
    },
  ])
  joinMethod: Array<{
    devicesType: string;
    totalTime: {
      hours: string;
      minutes: string;
      seconds: string;
    };
    joinTime: Date;
  }>;
}

export const UserTotalTimeSchema = SchemaFactory.createForClass(UserTotalTime);
