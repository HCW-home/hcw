export interface ColumnConfig<T> {
  key: keyof T | 'action';
  label: string;
  center?: boolean;
  sortKey?: string;
}
