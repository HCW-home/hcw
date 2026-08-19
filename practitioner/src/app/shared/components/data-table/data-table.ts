import {
  Component,
  computed,
  contentChildren,
  input,
  output,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { TranslatePipe } from '@ngx-translate/core';
import { Button } from '../../ui-components/button/button';
import { Svg } from '../../ui-components/svg/svg';
import { Loader } from '../loader/loader';
import { ButtonSizeEnum, ButtonStyleEnum } from '../../constants/button';
import { DataTableCellDirective } from './data-table-cell.directive';

export interface DataTableColumn {
  /** Matches the `appDataTableCell` key of the template rendering this column. */
  key: string;
  /** Header label, already translated. Leave empty for action columns. */
  label?: string;
  /** CSS grid track for the column, e.g. 'minmax(230px, 2.3fr)' or '40px'. */
  width?: string;
  align?: 'start' | 'center' | 'end';
  /** Lets the cell wrap on several lines instead of being truncated. */
  wrap?: boolean;
  /** Drops the column from the stacked layout used on small screens. */
  hideOnMobile?: boolean;
}

const DEFAULT_COLUMN_WIDTH = 'minmax(120px, 1fr)';

/**
 * Card shaped data table shared by every listing screen: sticky-ish header row,
 * cell templates declared by the caller, and the loading / error / empty /
 * footer states handled once instead of in each page.
 */
@Component({
  selector: 'app-data-table',
  imports: [NgTemplateOutlet, TranslatePipe, Button, Svg, Loader],
  templateUrl: './data-table.html',
  styleUrl: './data-table.scss',
})
export class DataTable<T> {
  columns = input.required<DataTableColumn[]>();
  rows = input.required<T[]>();
  /** Width below which the table scrolls horizontally instead of squeezing. */
  minWidth = input<number>(960);
  loading = input<boolean>(false);
  loadingMore = input<boolean>(false);
  error = input<string | null>(null);
  /** Already translated footer text, e.g. "12 suivis sur 34". */
  summary = input<string>('');
  hasMore = input<boolean>(false);
  clickable = input<boolean>(true);
  /** Stacks rows into label / value pairs on small screens. */
  responsive = input<boolean>(true);
  /** Returns the colour of the row accent rail, or null to hide it. */
  rowAccent = input<((row: T) => string | null) | null>(null);
  /** Marks a row as needing attention (tinted background). */
  rowHighlighted = input<((row: T) => boolean) | null>(null);
  trackBy = input<(row: T, index: number) => unknown>((_, index) => index);

  rowClick = output<T>();
  loadMore = output<void>();
  retry = output<void>();

  private cellDefs = contentChildren(DataTableCellDirective, { descendants: true });

  private cellTemplates = computed(
    () => new Map(this.cellDefs().map(def => [def.appDataTableCell(), def.template]))
  );

  protected readonly ButtonSizeEnum = ButtonSizeEnum;
  protected readonly ButtonStyleEnum = ButtonStyleEnum;

  protected gridTemplate = computed(() =>
    this.columns()
      .map(column => column.width ?? DEFAULT_COLUMN_WIDTH)
      .join(' ')
  );

  protected hasRail = computed(() => this.rowAccent() !== null);

  protected templateFor(key: string) {
    return this.cellTemplates().get(key) ?? null;
  }

  protected accentFor(row: T): string | null {
    return this.rowAccent()?.(row) ?? null;
  }

  protected isHighlighted(row: T): boolean {
    return this.rowHighlighted()?.(row) ?? false;
  }

  protected trackRow = (row: T, index: number): unknown =>
    this.trackBy()(row, index);

  protected onRowClick(row: T): void {
    if (this.clickable()) {
      this.rowClick.emit(row);
    }
  }

  /** Rows behave like buttons, so Enter and Space open them as a click does. */
  protected onRowKeydown(event: KeyboardEvent, row: T): void {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    this.onRowClick(row);
  }
}
