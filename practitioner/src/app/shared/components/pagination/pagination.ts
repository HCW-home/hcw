import { Component, input, OnChanges, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Typography } from '../../ui-components/typography/typography';
import { TypographyTypeEnum } from '../../constants/typography';
import { Button } from '../../ui-components/button/button';
import { ButtonSizeEnum, ButtonStateEnum, ButtonStyleEnum } from '../../constants/button';

@Component({
  selector: 'app-pagination',
  imports: [FormsModule, Typography, Button],
  templateUrl: './pagination.html',
  styleUrl: './pagination.scss',
})
export class Pagination implements OnChanges {
  currentPage = input<number>(1);
  totalPages = input<number>(1);
  currentItemsLength = input<number>(0);
  totalCount = input<number>(0);
  itemsPerPageOptions: number[] = [10, 25, 50];
  itemsPerPage = this.itemsPerPageOptions[0];

  previous = output<boolean>();
  next = output<boolean>();
  pageSelect = output<number>();
  itemsPerPageChange = output<number>();

  pages: (number | string)[] = [];

  ngOnChanges(): void {
    this.updatePageNumbers();
  }

  updatePageNumbers() {
    const range = 3;
    this.pages = [];

    if (this.totalPages() <= 1) {
      return;
    }

    this.pages.push(1);

    const startPage = Math.max(2, this.currentPage() - range);
    const endPage = Math.min(this.totalPages() - 1, this.currentPage() + range);

    if (startPage > 2) {
      this.pages.push('...');
    }

    for (let i = startPage; i <= endPage; i++) {
      this.pages.push(i);
    }

    if (endPage < this.totalPages() - 1) {
      this.pages.push('...');
    }

    if (this.totalPages() > 1 && endPage < this.totalPages()) {
      this.pages.push(this.totalPages());
    }
  }

  previousPage() {
    this.previous.emit(true);
  }

  nextPage() {
    this.next.emit(true);
  }

  itemsPerPageChanged() {
    this.itemsPerPageChange.emit(this.itemsPerPage);
  }

  selectPage(page: number | string) {
    if (typeof page === 'number') {
      this.pageSelect.emit(page);
    }
  }

  protected readonly TypographyTypeEnum = TypographyTypeEnum;
  protected readonly ButtonStyleEnum = ButtonStyleEnum;
  protected readonly ButtonStateEnum = ButtonStateEnum;
  protected readonly ButtonSizeEnum = ButtonSizeEnum;
}
