import {
  AfterViewChecked,
  Component,
  ElementRef,
  OnDestroy,
  ViewChild,
  effect,
  input,
  output,
  inject,
  DOCUMENT,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Svg } from '../../ui-components/svg/svg';
import { Typography } from '../../ui-components/typography/typography';
import { TypographyTypeEnum } from '../../constants/typography';

@Component({
  selector: 'app-modal',
  imports: [CommonModule, Svg, Typography],
  templateUrl: './modal.component.html',
  styleUrl: './modal.component.scss'
})
export class ModalComponent implements AfterViewChecked, OnDestroy {
  isOpen = input<boolean>(false);
  title = input<string>('');
  // Optional contextual help shown in a tooltip next to the title.
  titleHelp = input<string>('');
  size = input<'small' | 'medium' | 'large' | 'xlarge'>('medium');
  showCloseButton = input<boolean>(true);
  closeOnBackdropClick = input<boolean>(true);

  closed = output<void>();

  protected readonly TypographyTypeEnum = TypographyTypeEnum;

  // Teleport target — the backdrop DOM node is moved to <body> while the
  // modal is open so its `position: fixed` is anchored to the viewport,
  // not to a transformed ancestor (e.g. another modal that itself runs
  // a CSS animation with `transform`, which creates a new containing
  // block; any nested modal would otherwise render inline inside it).
  @ViewChild('backdropRef')
  private backdropRef?: ElementRef<HTMLElement>;
  private document = inject(DOCUMENT);
  private teleportedNode: HTMLElement | null = null;
  private wantsAttach = false;

  constructor() {
    effect(() => {
      if (this.isOpen()) {
        this.wantsAttach = true;
      } else {
        this.wantsAttach = false;
        this.detachFromBody();
      }
    });
  }

  ngAfterViewChecked(): void {
    // After Angular has rendered/refreshed the view, the @ViewChild has its
    // backdrop element ready. If the modal wants to be attached, do it now.
    if (this.wantsAttach && !this.teleportedNode && this.backdropRef) {
      this.teleportedNode = this.backdropRef.nativeElement;
      this.document.body.appendChild(this.teleportedNode);
    }
  }

  ngOnDestroy(): void {
    this.detachFromBody();
  }

  close(): void {
    this.closed.emit();
  }

  onBackdropClick(event: MouseEvent): void {
    if (this.closeOnBackdropClick() && (event.target as HTMLElement).classList.contains('modal-backdrop')) {
      this.close();
    }
  }

  private detachFromBody(): void {
    if (!this.teleportedNode) {
      return;
    }
    if (this.teleportedNode.parentElement === this.document.body) {
      this.document.body.removeChild(this.teleportedNode);
    }
    this.teleportedNode = null;
  }
}
