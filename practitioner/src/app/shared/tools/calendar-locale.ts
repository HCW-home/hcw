import { CalendarApi } from '@fullcalendar/core';

// Maps short app language codes to FullCalendar's locale bundle names where they
// differ (FullCalendar ships regional variants for some languages, and lacks a
// few entirely — those fall back to English via the catch below).
const LOCALE_ALIASES: Record<string, string> = {
  zh: 'zh-cn',
};

/**
 * Localizes a FullCalendar instance to the given language code by lazily loading
 * the matching locale bundle from `@fullcalendar/core/locales`. Falls back to the
 * built-in English locale when the bundle is missing or fails to load.
 *
 * FullCalendar locales carry their own `firstDay`; pass `firstDayOverride` to keep
 * the admin-configured first day of week, which is re-applied after the locale so
 * it always wins.
 */
export async function applyCalendarLocale(
  api: CalendarApi | undefined,
  langCode: string,
  firstDayOverride?: number,
): Promise<void> {
  if (!api) {
    return;
  }

  const requested = (langCode || 'en').toLowerCase();
  const code = LOCALE_ALIASES[requested] ?? requested;
  try {
    if (code !== 'en') {
      const module = await import(
        /* @vite-ignore */ `@fullcalendar/core/locales/${code}.js`
      );
      api.setOption('locale', module.default ?? module);
    } else {
      api.setOption('locale', 'en');
    }
  } catch {
    api.setOption('locale', 'en');
  }

  if (firstDayOverride !== undefined) {
    api.setOption('firstDay', firstDayOverride);
  }
}
