/**
 * Single source of "now" for all business rules. Tests replace it to pin time;
 * nothing else in the code base calls `new Date()` for rule decisions.
 */
export const clock = {
  now: (): Date => new Date(),
};
