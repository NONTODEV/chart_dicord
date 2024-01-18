export function formatSpeakingTime(speakingTime: Array<{ hours: string; minutes: string; seconds: string }>): string {
    return speakingTime.map(time => `${time.hours} hours, ${time.minutes} minutes, ${time.seconds} seconds`).join('\n');
  }