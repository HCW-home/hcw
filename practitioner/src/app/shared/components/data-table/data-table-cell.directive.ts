import { Directive, TemplateRef, inject, input } from '@angular/core';

/** Context handed to every cell template rendered by `app-data-table`. */
export interface DataTableCellContext<T> {
  /** The row the cell belongs to. */
  $implicit: T;
  /** Zero based index of the row within the loaded page. */
  index: number;
}

/**
 * Declares how one column is rendered:
 * `<ng-template appDataTableCell="patient" let-row>…</ng-template>`.
 * The key must match the `key` of a `DataTableColumn` given to the table.
 */
@Directive({
  selector: 'ng-template[appDataTableCell]',
})
export class DataTableCellDirective<T = unknown> {
  appDataTableCell = input.required<string>();
  readonly template = inject<TemplateRef<DataTableCellContext<T>>>(TemplateRef);
}
