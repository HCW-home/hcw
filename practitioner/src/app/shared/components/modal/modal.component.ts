import {
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
export class ModalComponent implements OnDestroy {
  isOpen = input<boolean>(false);
  title = input<string>('');
  size = input<'small' | 'medium' | 'large' | 'xlarge'>('medium');
  showCloseButton = input<boolean>(true);
  closeOnBackdropClick = input<boolean>(true);

  closed = output<void>();

  protected readonly TypographyTypeEnum = TypographyTypeEnum;

  // Teleport target — the DOM node housing the backdrop is moved to
  // <body> while the modal is open so its `position: fixed` is anchored to
  // the viewport, not to a transformed ancestor (e.g. an Angular animation
  // creates a containing block on the route component).
  @ViewChild('backdropRef')
  private backdropRef?: ElementRef<HTMLElement>;
  private hostElement: HTMLElement = inject(ElementRef).nativeElement;
  private document = inject(DOCUMENT);
  private teleportedNode: HTMLElement | null = null;

  constructor() {
    effect(() => {
      if (this.isOpen()) {
        // Defer to the next microtask so the @if branch is rendered.
        queueMicrotask(() => this.attachToBody());
      } else {
        this.detachFromBody();
      }
    });
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

  private attachToBody(): void {
    if (this.teleportedNode) {
      return;
    }
    const node = this.backdropRef?.nativeElement
      ?? this.hostElement.querySelector<HTMLElement>('.modal-backdrop');
    if (!node) {
      return;
    }
    this.teleportedNode = node;
    this.document.body.appendChild(node);
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
