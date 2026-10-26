// Fixed English month names, as P6 prints them. Locale data in some
// browsers gives "Sept", which planners don't expect.
export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const monthShort = (d: Date) => MONTHS[d.getUTCMonth()];
