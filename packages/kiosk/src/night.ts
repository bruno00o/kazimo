export function isNightHour(hour: number, startHour: number, endHour: number): boolean {
  if (startHour === endHour) return false;
  if (startHour < endHour) return hour >= startHour && hour < endHour;
  return hour >= startHour || hour < endHour;
}

export function isNightAt(date: Date, startHour: number, endHour: number): boolean {
  return isNightHour(date.getHours(), startHour, endHour);
}
