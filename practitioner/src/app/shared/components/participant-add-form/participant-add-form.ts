import {
  Component,
  EventEmitter,
  Input,
  Output,
  signal,
  viewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslatePipe } from '@ngx-translate/core';

import { CreateParticipantRequest } from '../../../core/models/consultation';
import { IUser } from '../../../modules/user/models/user';

import { Button } from '../../ui-components/button/button';
import { ModalComponent } from '../modal/modal.component';
import { ContactPicker } from '../contact-picker/contact-picker';
import { ContactSelection } from '../../models/contact-picker';
import { ButtonSizeEnum, ButtonStyleEnum } from '../../constants/button';

/**
 * Modal used to describe a participant to add, either an existing account or a
 * temporary contact reachable by e-mail, SMS or a manual invitation link. The
 * whole "who" part is delegated to the shared contact picker.
 *
 * The component only builds the payload and emits it: persisting it is left to
 * the host, which either queues it locally (appointment creation/edition) or
 * posts it right away (adding someone to a running call).
 */
@Component({
  selector: 'app-participant-add-form',
  templateUrl: './participant-add-form.html',
  styleUrl: './participant-add-form.scss',
  imports: [
    Button,
    CommonModule,
    ModalComponent,
    ContactPicker,
    TranslatePipe,
  ],
})
export class ParticipantAddForm {
  // The picker lives behind @if (isOpen), so it is recreated empty on every
  // open: drop the previous selection with it, whichever way the modal closed.
  @Input() set isOpen(value: boolean) {
    this._isOpen = value;
    if (!value) {
      this.selection.set(null);
    }
  }
  get isOpen(): boolean {
    return this._isOpen;
  }
  @Input() currentUser: IUser | null = null;
  @Input() isSubmitting = false;
  @Input() disableSubmit = false;
  @Input() highlightExternalGuest = false;
  @Input() highlightExternalEmail = false;
  @Input() highlightVisibleCheckbox = false;
  @Input() highlightSubmit = false;

  @Output() added = new EventEmitter<CreateParticipantRequest>();
  @Output() closed = new EventEmitter<void>();
  @Output() externalGuestSelected = new EventEmitter<void>();

  participantPickerRef = viewChild<ContactPicker>('participantPickerRef');
  selection = signal<ContactSelection | null>(null);

  private _isOpen = false;

  protected readonly ButtonStyleEnum = ButtonStyleEnum;
  protected readonly ButtonSizeEnum = ButtonSizeEnum;

  hasSelection(): boolean {
    return this.selection() !== null;
  }

  onSelectionChange(selection: ContactSelection | null): void {
    this.selection.set(selection);
    if (selection?.kind === 'guest') {
      this.externalGuestSelected.emit();
    }
  }

  addParticipant(): void {
    const picker = this.participantPickerRef();
    if (!picker) return;

    picker.markAllTouched();
    if (!picker.isValid()) return;

    const user = picker.currentUser();
    if (user) {
      this.added.emit({
        user_id: user.pk,
        first_name: user.first_name,
        last_name: user.last_name,
        email: user.email,
        is_consultation_visible: picker.isConsultationVisible(),
      });
      return;
    }

    const guest = picker.buildGuestPayload();
    if (!guest) return;
    this.added.emit(guest);
  }

  /** Bring the form back to its pristine state. Called by hosts after a save. */
  reset(): void {
    this.selection.set(null);
    this.participantPickerRef()?.reset();
  }

  onClose(): void {
    this.reset();
    this.closed.emit();
  }
}
