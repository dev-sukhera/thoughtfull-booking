import { DateTime } from 'luxon';

/**
 * All display formatting uses the timezone saved on the user's account,
 * not the browser's, so what people see matches what the server reasons about.
 */
export const inZone = (iso: string, tz: string) => DateTime.fromISO(iso, { zone: tz });

export const fmtDateTime = (iso: string, tz: string) => inZone(iso, tz).toFormat('ccc d LLL yyyy, HH:mm');
export const fmtTime = (iso: string, tz: string) => inZone(iso, tz).toFormat('HH:mm');
export const fmtDayLong = (isoDate: string) => DateTime.fromISO(isoDate).toFormat('cccc d LLLL yyyy');
export const fmtRange = (startIso: string, endIso: string, tz: string) =>
  `${fmtDateTime(startIso, tz)}–${fmtTime(endIso, tz)}`;
export const tzLabel = (tz: string) => `${tz.replace(/_/g, ' ')} (${DateTime.now().setZone(tz).toFormat('ZZZZ')})`;

export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export function allTimezones(): string[] {
  const fn = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf;
  const list = fn ? fn('timeZone') : [];
  return list.includes('UTC') ? list : ['UTC', ...list];
}

export const browserTimezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
