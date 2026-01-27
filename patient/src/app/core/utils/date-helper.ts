export function extractDateFromISO(isoString: string): string {
  const match = isoString.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : '';
}

export function extractTimeFromISO(isoString: string): string {
  const match = isoString.match(/T(\d{2}:\d{2})/);
  return match ? match[1] : '';
}

export function parseDateWithoutTimezone(isoString: string): Date | null {
  const datePart = extractDateFromISO(isoString);
  const timePart = extractTimeFromISO(isoString);
  if (!datePart) return null;

  const [year, month, day] = datePart.split('-').map(Number);
  const [hours, minutes] = timePart ? timePart.split(':').map(Number) : [0, 0];

  return new Date(year, month - 1, day, hours, minutes);
}

export function formatDateFromISO(isoString: string): string {
  const date = parseDateWithoutTimezone(isoString);
  if (!date) return '';

  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  const dayName = days[date.getDay()];
  const monthName = months[date.getMonth()];
  const dayOfMonth = date.getDate();
  const year = date.getFullYear();

  return `${dayName}, ${monthName} ${dayOfMonth}, ${year}`;
}

export function formatTimeFromISO(isoString: string): string {
  const date = parseDateWithoutTimezone(isoString);
  if (!date) return '';

  let hours = date.getHours();
  const minutes = date.getMinutes();
  const ampm = hours >= 12 ? 'PM' : 'AM';

  hours = hours % 12;
  hours = hours ? hours : 12;
  const minutesStr = minutes.toString().padStart(2, '0');

  return `${hours}:${minutesStr} ${ampm}`;
}
