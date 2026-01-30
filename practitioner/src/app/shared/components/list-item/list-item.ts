import { Component, Input, Output, EventEmitter, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';

export type ListItemVariant = 'default' | 'active' | 'past' | 'overdue' | 'temporary';

@Component({
  selector: 'app-list-item',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './list-item.html',
  styleUrl: './list-item.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ListItem {
  @Input() variant: ListItemVariant = 'default';
  @Input() avatarText = '';
  @Input() showOnlineIndicator = false;
  @Input() clickable = true;
  @Output() itemClick = new EventEmitter<void>();

  onClick(): void {
    if (this.clickable) {
      this.itemClick.emit();
    }
  }
}
