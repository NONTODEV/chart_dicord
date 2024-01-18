interface SubTotalData {
    devicesType: string;
    totalTime: string;
}

export interface UserData {
    discordName: string;
    serverName: string;
    joinMethod: SubTotalData[];
    totalTime: string;
    sPeakingTime: string[];
}