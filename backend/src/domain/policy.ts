/** Members may cancel or reschedule only while the session is at least this far away. */
export const MEMBER_CHANGE_CUTOFF_HOURS = 24;
const CUTOFF_MS = MEMBER_CHANGE_CUTOFF_HOURS * 60 * 60 * 1000;

/** The last instant at which a member may still cancel or reschedule. */
export function memberChangeDeadline(startsAt: Date): Date {
  return new Date(startsAt.getTime() - CUTOFF_MS);
}

/**
 * "Up to 24 hours before it starts": allowed when the session starts 24h or more
 * from now (exactly 24h is still allowed), blocked once fewer than 24h remain.
 */
export function memberCanChange(startsAt: Date, now: Date): boolean {
  return now.getTime() <= memberChangeDeadline(startsAt).getTime();
}

/** Professionals can cancel any session that has not started yet. */
export function professionalCanCancel(startsAt: Date, now: Date): boolean {
  return now.getTime() < startsAt.getTime();
}
