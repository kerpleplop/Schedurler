export function isValidClockTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

export function minutesSinceMidnight(clockTime: string): number {
  const [hours, minutes] = clockTime.split(":").map(Number);
  return hours * 60 + minutes;
}
