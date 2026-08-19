import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { DataTable, DataTableColumn } from './data-table';
import { DataTableCellDirective } from './data-table-cell.directive';

interface Row {
  id: number;
  name: string;
}

@Component({
  imports: [DataTable, DataTableCellDirective],
  template: `
    <app-data-table
      [columns]="columns"
      [rows]="rows()"
      [rowAccent]="accent"
      [trackBy]="trackRow"
      [summary]="summary"
      (rowClick)="clicked = $event">
      <div slot="empty" class="empty-slot">nothing here</div>
      <ng-template appDataTableCell="name" let-row>
        <span class="name-cell">{{ row.name }}</span>
      </ng-template>
      <ng-template appDataTableCell="id" let-row>
        <span class="id-cell">{{ row.id }}</span>
      </ng-template>
    </app-data-table>
  `,
})
class HostComponent {
  columns: DataTableColumn[] = [
    { key: 'name', label: 'Name', width: 'minmax(120px, 2fr)' },
    { key: 'id', label: 'Id', width: '80px' },
  ];
  rows = signal<Row[]>([
    { id: 1, name: 'Alice' },
    { id: 2, name: 'Bob' },
  ]);
  summary = '2 of 2';
  clicked: Row | null = null;
  readonly accent = (row: Row): string | null => (row.id === 1 ? 'red' : null);
  readonly trackRow = (row: Row): number => row.id;
}

describe('DataTable', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  const query = (selector: string): HTMLElement[] =>
    Array.from(fixture.nativeElement.querySelectorAll(selector));

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent, TranslateModule.forRoot()],
    }).compileComponents();

    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('renders one header cell per column', () => {
    expect(query('.dt-th').map(el => el.textContent?.trim())).toEqual([
      'Name',
      'Id',
    ]);
  });

  it('renders every row through the matching cell template', () => {
    expect(query('.dt-row').length).toBe(2);
    expect(query('.name-cell').map(el => el.textContent?.trim())).toEqual([
      'Alice',
      'Bob',
    ]);
    expect(query('.id-cell').map(el => el.textContent?.trim())).toEqual([
      '1',
      '2',
    ]);
  });

  it('lays rows out on the grid tracks declared by the columns', () => {
    const row = query('.dt-row')[0];
    expect(row.style.gridTemplateColumns).toBe('minmax(120px, 2fr) 80px');
  });

  it('paints the accent rail returned for the row', () => {
    const rails = query('.dt-rail');
    expect(rails.length).toBe(2);
    expect(rails[0].style.background).toBe('red');
    expect(rails[1].style.background).toBe('');
  });

  it('emits the clicked row', () => {
    query('.dt-row')[1].click();
    expect(host.clicked).toEqual({ id: 2, name: 'Bob' });
  });

  it('opens the row with the keyboard', () => {
    query('.dt-row')[0].dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter' })
    );
    expect(host.clicked).toEqual({ id: 1, name: 'Alice' });
  });

  it('shows the summary in the footer', () => {
    expect(query('.dt-summary')[0].textContent?.trim()).toBe('2 of 2');
  });

  it('falls back to the empty slot when there is no row', () => {
    host.rows.set([]);
    fixture.detectChanges();

    expect(query('.dt-row').length).toBe(0);
    expect(query('.empty-slot').length).toBe(1);
  });
});
