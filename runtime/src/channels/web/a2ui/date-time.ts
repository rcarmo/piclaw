import type { A2uiComponent } from './surface.js';

type DateTimeType = 'date' | 'time' | 'datetime-local';

export function a2uiDateTimeType(item: A2uiComponent): DateTimeType | undefined {
  const time = item.enableTime === true;
  const date = item.enableDate === true || (item.enableDate === undefined && !time);
  return date && time ? 'datetime-local' : date ? 'date' : time ? 'time' : undefined;
}

const datePattern = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/;
const timePattern = /^([01][0-9]|2[0-3]):([0-5][0-9])(?::([0-5][0-9])(?:\.([0-9]+))?)?(?:Z|[+-](?:[01][0-9]|2[0-3]):[0-5][0-9])?$/;

function validDate(value: string) {
  const match = datePattern.exec(value);
  if (!match) return false;
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return year > 0 && month >= 1 && month <= 12 && day >= 1
    && day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]!;
}

function readDateTime(value: unknown) {
  if (typeof value !== 'string' || value.length > 4096 || value.trim() !== value) return;
  const separator = value.indexOf('T');
  const date = separator >= 0 ? value.slice(0, separator) : value.includes(':') ? undefined : value;
  const rawTime = separator >= 0 ? value.slice(separator + 1) : date === undefined ? value : undefined;
  const time = rawTime === undefined ? undefined : timePattern.exec(rawTime);
  if ((date !== undefined && !validDate(date)) || (rawTime !== undefined && !time)) return;
  const fraction = time?.[4]?.replace(/0+$/, '');
  return {
    date,
    time: time ? `${time[1]}:${time[2]}:${time[3] ?? '00'}${fraction ? '.' + fraction : ''}` : undefined,
  };
}

function project(parsed: ReturnType<typeof readDateTime>, type: DateTimeType): string | undefined {
  if (!parsed) return;
  if (type === 'date') return parsed.date;
  if (type === 'time') return parsed.time;
  if (parsed.date && parsed.time) return `${parsed.date}T${parsed.time}`;
}

/** Native inputs display civil time; a supplied offset never shifts the displayed wall clock. */
export function a2uiDateTimeDisplay(value: unknown, type: DateTimeType): string | undefined {
  return project(readDateTime(value), type);
}

export function validA2uiDateTime(type: DateTimeType, value: unknown, min: unknown, max: unknown): boolean {
  if (value === '') return true;
  const parsed = readDateTime(value);
  if (!parsed || (type === 'date' && parsed.time) || (type === 'time' && parsed.date)) return false;
  const current = project(parsed, type);
  const lower = a2uiDateTimeDisplay(min, type), upper = a2uiDateTimeDisplay(max, type);
  return current !== undefined && (lower === undefined || current >= lower) && (upper === undefined || current <= upper);
}
