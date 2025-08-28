import { Component,  } from '@angular/core';
import { backdropAnimation } from '../../animations/modal';

@Component({
  selector: 'app-modal',
  imports: [],
  templateUrl: './modal.component.html',
  styleUrl: './modal.component.scss',
  animations: [backdropAnimation],
})
export class ModalComponent {
  // @Input() title = '';
  // @Input() description = '';
  // @Input() buttons: ModalButton[] = [];
  // @Input() showCloseIcon = false;
  // @Output() buttonClick = new EventEmitter<ModalButton>();
  // @Output() backdropClick = new EventEmitter<void>();

  // onButtonClick(button: ModalButton): void {
  //   this.buttonClick.emit(button);
  // }

  // onBackdropClick(): void {
  //   this.backdropClick.emit();
  // }
}
