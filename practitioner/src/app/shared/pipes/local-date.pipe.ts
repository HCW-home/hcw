import { Pipe, PipeTransform } from '@angular/core';
import { DatePipe } from '@angular/common';
import { parseDateWithoutTimezone } from '../tools/helper';

@Pipe({
  name: 'localDate',
  standalone: true,
})
export class LocalDatePipe implements PipeTransform {
  private datePipe = new DatePipe('en-US');

  transform(value: string | null | undefined, format: string = 'MMM d, y, HH:mm'): string {
    if (!value) return '';

    const date = parseDateWithoutTimezone(value);
    if (!date) return '';

    return this.datePipe.transform(date, format) || '';
  }
}
