import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema()
export class CronUserTotalTime extends Document {
    @Prop()
    discordName: string;

    @Prop()
    userId: string;

    @Prop()
    serverName: string;

    @Prop()
    totalTime: string;

    @Prop()
    sPeakingTime: Array<{
        hours: string;
        minutes: string;
        seconds: string;
    }>;

    @Prop()
    joinMethod: Array<{
        devicesType: string;
        totalTime: {
        hours: string;
        minutes: string;
        seconds: string;
        };
    }>;

    @Prop({ default: Date.now })
    createdAt: Date;
}

export const CronUserTotalTimeSchema = SchemaFactory.createForClass(CronUserTotalTime);