export interface PickerOption {
  value: string;
  label: string;
}

export interface PickerColumn {
  options: PickerOption[];
}

export function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

export function loopRepeatFor(length: number): number {
  if (length >= 100) return 5;
  if (length >= 30) return 9;
  return 18;
}

export function buildNumberColumn(start: number, end: number, pad = true): PickerColumn {
  const options: PickerOption[] = [];
  for (let value = start; value <= end; value += 1) {
    const text = pad ? pad2(value) : String(value);
    options.push({ value: text, label: text });
  }
  return { options };
}

export function buildTimeColumns(): PickerColumn[] {
  return [buildNumberColumn(0, 23), buildNumberColumn(0, 59)];
}

export function buildDateColumns(
  current: string,
  startDate: string,
  endDate: string,
): PickerColumn[] {
  const startYear = Number(startDate.slice(0, 4));
  const endYear = Number(endDate.slice(0, 4));
  const [yearText, monthText] = current.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();

  return [
    {
      options: Array.from({ length: endYear - startYear + 1 }, (_, index) => {
        const value = String(startYear + index);
        return { value, label: `${value} 年` };
      }),
    },
    {
      options: Array.from({ length: 12 }, (_, index) => {
        const value = pad2(index + 1);
        return { value, label: `${index + 1} 月` };
      }),
    },
    {
      options: Array.from({ length: daysInMonth }, (_, index) => {
        const value = pad2(index + 1);
        return { value, label: `${index + 1} 日` };
      }),
    },
  ];
}

export function clampDateParts(
  year: string,
  month: string,
  day: string,
  startDate: string,
  endDate: string,
): string {
  const daysInMonth = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
  const next = `${year}-${month}-${pad2(Math.min(Number(day) || 1, daysInMonth))}`;
  if (next < startDate) return startDate;
  if (next > endDate) return endDate;
  return next;
}

export function timeParts(value: string): [string, string] {
  const [hour = "00", minute = "00"] = value.split(":");
  return [pad2(Number(hour) || 0), pad2(Number(minute) || 0)];
}

export function dateParts(value: string): [string, string, string] {
  const [year = "2000", month = "01", day = "01"] = value.split("-");
  return [year, pad2(Number(month) || 1), pad2(Number(day) || 1)];
}

export function centerIndex(length: number, selectedIndex: number): number {
  if (length <= 0) return 0;
  const midCycle = Math.floor(loopRepeatFor(length) / 2);
  return midCycle * length + ((selectedIndex % length) + length) % length;
}

export function expandOptions(options: PickerOption[]): PickerOption[] {
  const repeat = loopRepeatFor(options.length);
  const expanded: PickerOption[] = [];
  for (let cycle = 0; cycle < repeat; cycle += 1) {
    for (const option of options) expanded.push(option);
  }
  return expanded;
}

export function resolveBaseIndex(index: number, length: number): number {
  if (length <= 0) return 0;
  return ((index % length) + length) % length;
}
