import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  OnInit,
  Output,
  SimpleChanges,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Subject, firstValueFrom, takeUntil } from 'rxjs';
import { TranslatePipe } from '@ngx-translate/core';

import { ConsultationService } from '../../../core/services/consultation.service';
import { ConsultationCryptoService } from '../../../core/services/consultation-crypto.service';
import { ConfirmationService } from '../../../core/services/confirmation.service';
import { ToasterService } from '../../../core/services/toaster.service';
import { TranslationService } from '../../../core/services/translation.service';
import { UserService } from '../../../core/services/user.service';
import { UserWebSocketService } from '../../../core/services/user-websocket.service';
import {
  AddParticipantsRequest,
  CreateParticipantRequest,
  ITemporaryParticipant,
  Participant,
} from '../../../core/models/consultation';
import { ParticipantInfo } from '../../../core/services/video-call.types';
import { IUser } from '../../../modules/user/models/user';
import { getErrorMessage } from '../../../core/utils/error-helper';

import { Button } from '../../ui-components/button/button';
import { Svg } from '../../ui-components/svg/svg';
import { Typography } from '../../ui-components/typography/typography';
import { Loader } from '../loader/loader';
import { ParticipantAddForm } from '../participant-add-form/participant-add-form';
import { ParticipantItem } from '../participant-item/participant-item';
import { ButtonSizeEnum, ButtonStyleEnum } from '../../constants/button';
import { TypographyTypeEnum } from '../../constants/typography';

/** A roster entry augmented with what the media server knows about the user. */
export interface InCallParticipantRow {
  participant: Participant;
  /** Media server view of that user, absent when they are not in the room. */
  live: ParticipantInfo | null;
}

/**
 * In-call roster: lists the appointment participants, shows who is actually
 * connected, and lets a practitioner invite someone or remove them from the
 * running call. Mirrors what the appointment form offers, without leaving the
 * call.
 */
@Component({
  selector: 'app-in-call-participants',
  templateUrl: './in-call-participants.html',
  styleUrl: './in-call-participants.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    Svg,
    Button,
    Loader,
    Typography,
    ParticipantAddForm,
    ParticipantItem,
    TranslatePipe,
  ],
})
export class InCallParticipants implements OnInit, OnChanges, OnDestroy {
  @Input({ required: true }) appointmentId!: number;
  @Input() consultationId?: number;
  /** Participants reported by the media server, keyed by LiveKit identity. */
  @Input() liveParticipants: ParticipantInfo[] = [];
  /** Whether the local user may mute others (LiveKit-only capability). */
  @Input() canModerate = false;
  /** Identities with a mute request in flight, to disable the button. */
  @Input() mutingIdentities: ReadonlySet<string> = new Set();

  @Output() closed = new EventEmitter<void>();
  @Output() muteToggle = new EventEmitter<ParticipantInfo>();

  private destroy$ = new Subject<void>();
  private consultationService = inject(ConsultationService);
  private cryptoService = inject(ConsultationCryptoService);
  private confirmationService = inject(ConfirmationService);
  private toasterService = inject(ToasterService);
  private userService = inject(UserService);
  private userWsService = inject(UserWebSocketService);
  private t = inject(TranslationService);
  private cdr = inject(ChangeDetectorRef);

  participants = signal<Participant[]>([]);
  isLoading = signal(false);
  isAdding = signal(false);
  showAddForm = signal(false);
  removingUserIds = signal<number[]>([]);
  currentUser = signal<IUser | null>(null);

  protected readonly ButtonStyleEnum = ButtonStyleEnum;
  protected readonly ButtonSizeEnum = ButtonSizeEnum;
  protected readonly TypographyTypeEnum = TypographyTypeEnum;

  ngOnInit(): void {
    this.userService.currentUser$
      .pipe(takeUntil(this.destroy$))
      .subscribe(user => {
        this.currentUser.set(user);
        this.cdr.markForCheck();
      });

    // Someone else changing the roster (or joining) must be reflected here.
    this.userWsService.appointmentEvent$
      .pipe(takeUntil(this.destroy$))
      .subscribe(event => {
        if (event.appointment_id !== this.appointmentId) return;
        if (
          event.state === 'participant_added'
          || event.state === 'participant_removed'
        ) {
          this.loadParticipants();
        }
      });

    this.loadParticipants();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['appointmentId'] && !changes['appointmentId'].firstChange) {
      this.loadParticipants();
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  /** Roster rows, connected participants first. */
  rows(): InCallParticipantRow[] {
    const liveByUserId = new Map<number, ParticipantInfo>();
    for (const live of this.liveParticipants) {
      const userId = this.userIdFromIdentity(live.identity);
      if (userId !== null) {
        liveByUserId.set(userId, live);
      }
    }

    return this.participants()
      .map(participant => ({
        participant,
        live: participant.user
          ? liveByUserId.get(participant.user.id) ?? null
          : null,
      }))
      .sort((a, b) => Number(!!b.live) - Number(!!a.live));
  }

  isRemoving(row: InCallParticipantRow): boolean {
    const userId = row.participant.user?.id;
    return userId !== undefined && this.removingUserIds().includes(userId);
  }

  isMuting(row: InCallParticipantRow): boolean {
    return !!row.live && this.mutingIdentities.has(row.live.identity);
  }

  /** Removing yourself is "leaving"; the backend refuses it anyway. */
  canRemove(row: InCallParticipantRow): boolean {
    const userId = row.participant.user?.id;
    return !!userId && userId !== this.currentUser()?.pk;
  }

  openAddForm(): void {
    this.showAddForm.set(true);
  }

  closeAddForm(): void {
    this.showAddForm.set(false);
  }

  onClose(): void {
    this.closed.emit();
  }

  async onParticipantAdded(data: CreateParticipantRequest): Promise<void> {
    if (this.isAdding()) return;

    const payload: AddParticipantsRequest = {};
    if (data.user_id) {
      payload.participants_ids = [data.user_id];
      payload.participants_visibility = [
        {
          user_id: data.user_id,
          is_consultation_visible: !!data.is_consultation_visible,
        },
      ];
    } else {
      const temporary: ITemporaryParticipant = {
        first_name: data.first_name,
        last_name: data.last_name,
        email: data.email,
        mobile_phone_number: data.mobile_phone_number,
        communication_method: data.communication_method,
        preferred_language: data.preferred_language,
        timezone: data.timezone,
        is_consultation_visible: data.is_consultation_visible,
      };
      payload.temporary_participants = [temporary];
    }

    this.isAdding.set(true);
    this.cdr.markForCheck();
    try {
      const participants = await firstValueFrom(
        this.consultationService.addAppointmentParticipants(
          this.appointmentId,
          payload
        )
      );
      this.participants.set(participants.filter(p => p.is_active));
      this.showAddForm.set(false);
      this.toasterService.show(
        'success',
        this.t.instant('inCallParticipants.participantAdded')
      );
      await this.provisionEncryptionKeys();
    } catch (error) {
      this.toasterService.show(
        'error',
        this.t.instant('inCallParticipants.addError'),
        getErrorMessage(error as HttpErrorResponse)
      );
    } finally {
      this.isAdding.set(false);
      this.cdr.markForCheck();
    }
  }

  async removeParticipant(row: InCallParticipantRow): Promise<void> {
    const userId = row.participant.user?.id;
    if (!userId || this.isRemoving(row)) return;

    const confirmed = await this.confirmationService.confirm({
      title: this.t.instant('inCallParticipants.removeTitle'),
      message: this.t.instant('inCallParticipants.removeMessage', {
        name: this.displayName(row),
      }),
      confirmText: this.t.instant('inCallParticipants.remove'),
      confirmStyle: 'danger',
    });
    if (!confirmed) return;

    this.removingUserIds.update(list => [...list, userId]);
    this.cdr.markForCheck();
    try {
      await firstValueFrom(
        this.consultationService.removeAppointmentParticipant(
          this.appointmentId,
          userId
        )
      );
      this.participants.update(list =>
        list.filter(p => p.user?.id !== userId)
      );
      this.toasterService.show(
        'success',
        this.t.instant('inCallParticipants.participantRemoved')
      );
    } catch (error) {
      this.toasterService.show(
        'error',
        this.t.instant('inCallParticipants.removeError'),
        getErrorMessage(error as HttpErrorResponse)
      );
    } finally {
      this.removingUserIds.update(list => list.filter(id => id !== userId));
      this.cdr.markForCheck();
    }
  }

  onMuteToggle(row: InCallParticipantRow): void {
    if (row.live) {
      this.muteToggle.emit(row.live);
    }
  }

  displayName(row: InCallParticipantRow): string {
    const user = row.participant.user;
    if (!user) return this.t.instant('participantItem.unknown');
    const fullName = `${user.first_name || ''} ${user.last_name || ''}`.trim();
    return fullName || user.email || this.t.instant('participantItem.unknown');
  }

  private loadParticipants(): void {
    if (!this.appointmentId) return;
    this.isLoading.set(true);
    this.cdr.markForCheck();
    this.consultationService
      .getAppointment(this.appointmentId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: appointment => {
          this.participants.set(
            (appointment.participants || []).filter(p => p.is_active)
          );
          this.isLoading.set(false);
          this.cdr.markForCheck();
        },
        error: () => {
          this.isLoading.set(false);
          this.cdr.markForCheck();
        },
      });
  }

  /**
   * Wrap the consultation key for participants who just gained chat access.
   * Without this they would join the call but see an undecryptable chat.
   */
  private async provisionEncryptionKeys(): Promise<void> {
    const consultationId = this.consultationId;
    const userId = this.currentUser()?.pk;
    if (!consultationId || !userId) return;

    try {
      const consultation = await firstValueFrom(
        this.consultationService.getConsultation(consultationId)
      );
      if (!consultation.is_encrypted) return;

      const privatePem = await this.cryptoService.loadConsultationPrivatePem(
        consultation,
        userId
      );
      if (!privatePem) return;

      const envelopes = await this.cryptoService.buildParticipantEnvelopes(
        this.participants(),
        privatePem
      );
      if (!envelopes.length) return;

      await firstValueFrom(
        this.consultationService.syncConsultationKeys(consultationId, envelopes)
      );
    } catch (err) {
      console.warn('[encryption] failed to provision new participant keys', err);
    }
  }

  /**
   * The LiveKit participant identity is `str(user.pk)`, optionally prefixed
   * with the tenant schema as `schema:pk`.
   */
  private userIdFromIdentity(identity: string): number | null {
    const segment = identity.split(':').pop() ?? identity;
    const pk = Number(segment);
    return Number.isInteger(pk) ? pk : null;
  }
}
