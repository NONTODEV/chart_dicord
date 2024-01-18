import { UserTotalTime } from "src/discord/schema/user-total-tiem.schema";
import { formatTotalTime } from "./format-total-time";

export function calculateTotalTime(userTotalTime: UserTotalTime, today: Date) {
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