import { IANAZone } from 'luxon';

export function isValidTimezone(tz: string): boolean {
  return IANAZone.isValidZone(tz);
}
