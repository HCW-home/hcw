import {
  Component,
  OnInit,
  OnDestroy,
  signal,
  inject,
  computed,
  viewChild,
  ElementRef,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { CommonModule, Location } from '@angular/common';
import { FormBuilder, FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { Observable, Subject, of, takeUntil, map, switchMap } from 'rxjs';
import { trigger, transition, style, animate, query, stagger } from '@angular/animations';

import { ConsultationService } from '../../../../core/services/consultation.service';
import { ConfirmationService } from '../../../../core/services/confirmation.service';
import { ToasterService } from '../../../../core/services/toaster.service';
import { ConsultationWebSocketService } from '../../../../core/services/consultation-websocket.service';
import { UserWebSocketService } from '../../../../core/services/user-websocket.service';
import { UserService } from '../../../../core/services/user.service';
import { IncomingCallService } from '../../../../core/services/incoming-call.service';
import { ActiveCallService } from '../../../../core/services/active-call.service';
import { Auth } from '../../../../core/services/auth';
import { EncryptionService } from '../../../../core/services/encryption.service';
import { ConsultationCryptoService } from '../../../../core/services/consultation-crypto.service';
import {
  Consultation,
  ConsultationMessage,
  Appointment,
  Participant,
  User,
  AppointmentStatus,
  AppointmentType,
  CustomField,
  Queue,
  CreateConsultationRequest,
  ConsultationKeyInput,
  ITemporaryParticipant,
} from '../../../../core/models/consultation';
import { IUser } from '../../models/user';

import { Page } from '../../../../core/components/page/page';
import { Loader } from '../../../../shared/components/loader/loader';
import {
  MessageList,
  Message,
  SendMessageData,
  EditMessageData,
  DeleteMessageData,
} from '../../../../shared/components/message-list/message-list';

import { Svg } from '../../../../shared/ui-components/svg/svg';
import { Button } from '../../../../shared/ui-components/button/button';
import { Badge } from '../../../../shared/components/badge/badge';
import { Input } from '../../../../shared/ui-components/input/input';
import { Textarea } from '../../../../shared/ui-components/textarea/textarea';
import { Switch } from '../../../../shared/ui-components/switch/switch';
import { Select, AsyncSearchFn, AsyncSearchResult } from '../../../../shared/ui-components/select/select';
import { SelectOption } from '../../../../shared/models/select';
import {
  ButtonStyleEnum,
  ButtonSizeEnum,
  ButtonStateEnum,
} from '../../../../shared/constants/button';
import { BadgeTypeEnum, BadgeSizeEnum } from '../../../../shared/constants/badge';
import {
  getParticipantBadgeType,
  getAppointmentBadgeType,
} from '../../../../shared/tools/helper';
import { LocalDatePipe } from '../../../../shared/pipes/local-date.pipe';
import { getErrorMessage } from '../../../../core/utils/error-helper';
import { ModalComponent } from '../../../../shared/components/modal/modal.component';
import { AppointmentFormModal } from './appointment-form-modal/appointment-form-modal';
import { ReminderFormModal } from '../../../../shared/components/reminder-form-modal/reminder-form-modal';
import { ReminderCard } from '../../../../shared/components/reminder-card/reminder-card';
import { ContactPicker } from '../../../../shared/components/contact-picker/contact-picker';
import { ContactSelection } from '../../../../shared/models/contact-picker';
import { Reminder } from '../../../../core/models/reminder';
import { RoutePaths } from '../../../../core/constants/routes';
import {
  AppointmentPanel,
  AppointmentTimeFilter,
} from '../../../../shared/components/appointment-panel/appointment-panel';
import { UserAvatar } from '../../../../shared/components/user-avatar/user-avatar';
import { TranslatePipe } from '@ngx-translate/core';
import { TranslationService } from '../../../../core/services/translation.service';


@Component({
  selector: 'app-consultation-detail',
  templateUrl: './consultation-detail.html',
  styleUrl: './consultation-detail.scss',
  imports: [
    Svg,
    Page,
    Loader,
    MessageList,
    CommonModule,
    ReactiveFormsModule,
    Button,
    Badge,
    Input,
    Textarea,
    Switch,
    Select,
    AppointmentFormModal,
    ReminderFormModal,
    ReminderCard,
    ContactPicker,
    ModalComponent,
    LocalDatePipe,
    AppointmentPanel,
    UserAvatar,
    TranslatePipe,
  ],
  animations: [
    trigger('listAnimation', [
      transition('* => *', [
        query(':enter', [
          style({ opacity: 0, transform: 'translateY(-10px)' }),
          stagger(50, [
            animate('300ms ease-out', style({ opacity: 1, transform: 'translateY(0)' }))
          ])
        ], { optional: true })
      ])
    ]),
    trigger('fadeIn', [
      transition(':enter', [
        style({ opacity: 0 }),
        animate('200ms ease-out', style({ opacity: 1 }))
      ])
    ])
  ]
})
export class ConsultationDetail implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  private location = inject(Location);
  private hostEl = inject(ElementRef<HTMLElement>);

  consultationId!: number;
  consultation = signal<Consultation | null>(null);
  appointments = signal<Appointment[]>([]);
  selectedAppointment = signal<Appointment | null>(null);

  isLoadingConsultation = signal(false);




  reminders = signal<Reminder[]>([]);
  // Total for the header summary: the list itself is paginated.
  reminderTotalCount = signal(0);
  isLoadingReminders = signal(false);
  isLoadingMoreReminders = signal(false);
  hasMoreReminders = signal(false);
  private reminderPage = 1;
  private reminderPageSize = 20;

  messages = signal<Message[]>([]);
  unreadSeparatorTimestamp = signal<string | null>(null);
  isWebSocketConnected = signal(false);
  currentUser = signal<IUser | null>(null);
  isLoadingMore = signal(false);
  hasMore = signal(true);
  private currentPage = 1;


  isCallingBeneficiary = signal(false);
  consultationCallConfig = signal<{ url: string; token: string; room: string } | undefined>(undefined);

  showBeneficiaryLinkModal = signal(false);
  beneficiaryAccessUrl = signal<string>('');
  beneficiaryLinkExpiresAt = signal<string | null>(null);
  loadingBeneficiaryAccessUrl = signal(false);
  beneficiaryLinkCopied = signal(false);


  upcomingAppointment = computed<Appointment | null>(() => {
    const now = Date.now();
    const earlyMs = this.appointmentEarlyJoinMinutes * 60 * 1000;
    return this.appointments().find(a => {
      if (a.status !== AppointmentStatus.SCHEDULED) return false;
      const start = new Date(a.scheduled_at).getTime();
      return (start - now) <= earlyMs;
    }) ?? null;
  });

  hasUpcomingAppointment = computed(() => !!this.upcomingAppointment());


  showCallAppointmentModal = signal(false);

  // Close follow-up modal: lets the practitioner fill in the internal
  // clinical notes before the consultation is closed.
  showCloseConsultationModal = signal(false);
  isClosingConsultation = signal(false);
  closeConsultationMessage = signal('');
  closeConsultationNotes = new FormControl<string>('', { nonNullable: true });

  isExportingPdf = signal(false);

  showCreateAppointmentModal = signal(false);
  showCreateReminderModal = signal(false);
  editingReminder = signal<Reminder | null>(null);
  editingAppointment = signal<Appointment | null>(null);

  private pendingJoinAppointmentId: number | null = null;
  private recentlyModifiedAppointmentIds = new Set<number>();




  customFields = signal<CustomField[]>([]);

  isEditMode = signal(false);
  isSavingConsultation = signal(false);
  queues = signal<Queue[]>([]);
  editForm!: FormGroup;
  /** Mirrors the title and description controls so the view can react to them. */
  editTitle = signal('');
  descriptionLength = signal(0);
  protected readonly DESCRIPTION_MAX_LENGTH = 500;

  /** Card heading: follows the field while editing, the saved title otherwise. */
  headerTitle = computed<string>(() => {
    const fallback = this.t.instant('consultationDetail.consultationNumber', {
      id: String(this.consultation()?.id ?? ''),
    });
    const title = this.isEditMode()
      ? this.editTitle()
      : this.consultation()?.title;
    return title || fallback;
  });
  selectedBeneficiary = signal<IUser | null>(null);
  selectedOwner = signal<IUser | null>(null);
  ownerInitialOption = signal<SelectOption | null>(null);
  // Toggle between an existing user and an external contact as beneficiary.
  isExternalBeneficiary = signal(false);
  externalBeneficiaryErrors = signal<Record<string, string[]>>({});
  beneficiaryPickerRef = viewChild<ContactPicker>('beneficiaryPickerRef');
  private practitionerCache = new Map<number, IUser>();

  private fb = inject(FormBuilder);

  queueOptions = computed<SelectOption[]>(() =>
    this.queues().map(queue => ({
      value: queue.id.toString(),
      label: queue.name,
    }))
  );

  practitionerSearchFn: AsyncSearchFn = (query: string, page: number): Observable<AsyncSearchResult> => {
    return this.userService.searchUsers(query, page, 20, false, undefined, true).pipe(
      map(response => {
        const results: SelectOption[] = response.results.map(user => {
          this.practitionerCache.set(user.pk, user);
          return this.userToSelectOption(user);
        });
        return { results, hasMore: response.next !== null };
      })
    );
  };

  private userToSelectOption(user: IUser): SelectOption {
    const currentUser = this.currentUser();
    const isCurrentUser = !!(currentUser && user.pk === currentUser.pk);
    const name = isCurrentUser
      ? this.t.instant('userSearchSelect.me')
      : `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.email || user.username || 'User';
    const firstName = user.first_name || '';
    const lastName = user.last_name || '';
    let initials: string;
    if (firstName && lastName) {
      initials = `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
    } else {
      initials = (firstName || lastName || user.email || 'U').charAt(0).toUpperCase();
    }
    return {
      value: user.pk,
      label: name,
      secondaryLabel: [user.email, user.mobile_phone_number].filter(Boolean).join(' · '),
      image: user.picture || undefined,
      initials,
      isCurrentUser,
      isPractitioner: user.is_practitioner,
    };
  }

  protected readonly AppointmentStatus = AppointmentStatus;
  protected readonly AppointmentType = AppointmentType;
  protected readonly ButtonStyleEnum = ButtonStyleEnum;
  protected readonly ButtonSizeEnum = ButtonSizeEnum;
  protected readonly ButtonStateEnum = ButtonStateEnum;
  protected readonly BadgeTypeEnum = BadgeTypeEnum;
  protected readonly BadgeSizeEnum = BadgeSizeEnum;
  protected readonly getParticipantBadgeType = getParticipantBadgeType;
  protected readonly getAppointmentBadgeType = getAppointmentBadgeType;

  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private consultationService = inject(ConsultationService);
  private confirmationService = inject(ConfirmationService);
  private toasterService = inject(ToasterService);
  private wsService = inject(ConsultationWebSocketService);
  private userWsService = inject(UserWebSocketService);
  private userService = inject(UserService);
  private incomingCallService = inject(IncomingCallService);
  activeCallService = inject(ActiveCallService);
  private authService = inject(Auth);
  private encryptionService = inject(EncryptionService);
  private cryptoService = inject(ConsultationCryptoService);
  private t = inject(TranslationService);

  // Decrypted consultation private RSA key, imported non-extractable so its
  // raw bytes never reach JS again. Used to decrypt every incoming message
  // envelope (envelope-per-message under consultation pubkey).
  private consultationPrivateKey: CryptoKey | null = null;
  // Cached PEM of the consultation's RSA private key. Held in memory only
  // (not persisted) — used to wrap the consultation key for newly added
  // participants/queues without having to round-trip through the user.
  private consultationPrivateKeyPem: string | null = null;
  // Set when the user has access to the encrypted consultation but none
  // of their envelopes (direct or queue-based) successfully unwrapped the
  // consultation private key — the chat is unreadable from this browser.
  // The reason narrows the root cause shown to the user.
  chatKeyError = signal<
    | null
    | 'no-local-key'
    | 'queue-only'
    | 'user-only'
    | 'mixed'
  >(null);

  consultationAutoDeleteHours = 0;
  // Only used by the "call the patient" flow; the panel owns its own copy.
  appointmentEarlyJoinMinutes = 5;

  appointmentPanel = viewChild(AppointmentPanel);
  appointmentInitialFilter = signal<AppointmentTimeFilter>('upcoming');
  // Set from the query params before the panel exists; applied once it does.
  private pendingHighlightAppointmentId: number | null = null;

  ngOnInit(): void {
    this.initEditForm();
    this.loadQueues();
    this.loadCustomFields();

    this.authService.getOpenIDConfig().subscribe({
      next: (config) => {
        this.consultationAutoDeleteHours = config.consultation_auto_delete_hours || 0;
        this.appointmentEarlyJoinMinutes = config.appointment_early_join_minutes || 5;
      },
      error: (err: unknown) => {
        console.error('Failed to get app config:', err);
      },
    });

    this.userService.currentUser$
      .pipe(takeUntil(this.destroy$))
      .subscribe(user => {
        this.currentUser.set(user);
      });

    this.route.params.pipe(takeUntil(this.destroy$)).subscribe(params => {
      this.consultationId = +params['id'];

      // If an appointmentId is in the URL, widen the filter to "all" so the
      // appointment is visible whether it is upcoming or past.
      // A deep link can point at a past appointment: start the panel on "all"
      // so the row is in the first page instead of being filtered out.
      const queryParams = this.route.snapshot.queryParams;
      this.appointmentInitialFilter.set(
        queryParams['appointmentId'] ? 'all' : 'upcoming'
      );

      this.loadConsultation();
      this.loadReminders();
      // loadMessages is triggered from inside loadConsultation once we know
      // whether the consultation is encrypted (and, if so, after the
      // consultation private key has been unwrapped). Calling it eagerly
      // here would download attachments without their decryptor and pin
      // broken URLs in the message-list image cache.
      this.connectWebSocket();
      this.checkJoinQueryParam();
      this.consultationService.markConsultationRead(this.consultationId)
        .pipe(takeUntil(this.destroy$))
        .subscribe();
    });

    this.setupWebSocketListeners();

    // Prevent tab/window close during video call
    window.addEventListener('beforeunload', this.handleBeforeUnload);
  }

  private initEditForm(): void {
    this.editForm = this.fb.group({
      title: [''],
      description: [''],
      beneficiary_id: [''],
      owned_by_id: [''],
      group_id: [''],
      visible_by_patient: [true],
    });

    // The card header shows the title being typed, so it has to follow it.
    this.editForm.get('title')?.valueChanges
      .pipe(takeUntil(this.destroy$))
      .subscribe(value => this.editTitle.set(value || ''));

    this.editForm.get('description')?.valueChanges
      .pipe(takeUntil(this.destroy$))
      .subscribe(value => this.descriptionLength.set((value || '').length));

    this.editForm.get('owned_by_id')?.valueChanges
      .pipe(takeUntil(this.destroy$))
      .subscribe(value => {
        if (value) {
          const user = this.practitionerCache.get(Number(value));
          this.selectedOwner.set(user || null);
        } else {
          this.selectedOwner.set(null);
        }
      });
  }

  private loadQueues(): void {
    this.consultationService
      .getQueues()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: queues => {
          this.queues.set(queues);
          if (queues.length === 0) {
            this.editForm.get('group_id')?.disable();
          }
        },
        error: error => {
          this.toasterService.show(
            'error',
            this.t.instant('consultationDetail.errorLoadingQueues'),
            getErrorMessage(error)
          );
          this.editForm.get('group_id')?.disable();
        },
      });
  }

  private loadCustomFields(): void {
    this.consultationService
      .getCustomFields('consultations.Consultation')
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: fields => {
          this.customFields.set(fields);
        },
      });
  }

  getCustomFieldOptions(field: CustomField): SelectOption[] {
    return (field.options || []).map(o => ({ value: o, label: o }));
  }

  private checkJoinQueryParam(): void {
    this.route.queryParams
      .pipe(takeUntil(this.destroy$))
      .subscribe(queryParams => {
        if (queryParams['appointmentId']) {
          const appointmentId = +queryParams['appointmentId'];
          this.pendingHighlightAppointmentId = appointmentId;

          if (queryParams['join'] === 'true') {
            this.pendingJoinAppointmentId = appointmentId;
            this.checkPendingJoin();
          }
        }
      });
  }

  private checkPendingJoin(): void {
    if (!this.pendingJoinAppointmentId) return;

    const appointment = this.appointments().find(a => a.id === this.pendingJoinAppointmentId);
    if (appointment) {
      const appointmentId = this.pendingJoinAppointmentId;
      this.pendingJoinAppointmentId = null;
      this.appointmentPanel()?.joinVideoCall(appointmentId);
    }
  }



  private handleBeforeUnload = (event: BeforeUnloadEvent): string | undefined => {
    if (this.activeCallService.hasActiveCall) {
      console.log('[ConsultationDetail] beforeunload - User is in call, showing confirmation dialog');
      // Prevent the page from closing without confirmation
      event.preventDefault();
      // Modern browsers ignore custom messages, but we still need to return a value
      return event.returnValue = '';
    }
    return undefined;
  };

  ngOnDestroy(): void {
    console.log('[ConsultationDetail] ngOnDestroy called - cleaning up resources');
    this.destroy$.next();
    this.destroy$.complete();
    this.wsService.disconnect();
    window.removeEventListener('beforeunload', this.handleBeforeUnload);
  }

  private connectWebSocket(): void {
    this.wsService.connect(this.consultationId);
  }

  private setupWebSocketListeners(): void {
    this.wsService.state$.pipe(takeUntil(this.destroy$)).subscribe(state => {
      this.isWebSocketConnected.set(state === 'CONNECTED');
    });

    this.wsService.messageUpdated$
      .pipe(takeUntil(this.destroy$))
      .subscribe(async event => {
        if (event.state === 'created') {
          const currentUser = this.currentUser();
          const isSystem = !event.data.created_by;
          const decryptedContent = await this.decryptMessageContent(
            event.data.content,
            event.data.is_encrypted,
          );
          const { attachment, attachmentDecrypt } =
            await this.buildAttachmentDecryptor(event.data as ConsultationMessage);

          const newMessage: Message = {
            id: event.data.id,
            username: isSystem
              ? ''
              : `${event.data.created_by.first_name} ${event.data.created_by.last_name}`,
            message: decryptedContent,
            timestamp: event.data.created_at,
            isCurrentUser: isSystem
              ? false
              : currentUser?.pk === event.data.created_by.id,
            isSystem,
            attachment,
            attachmentDecrypt,
            recording_url: event.data.recording_url,
            isEdited: event.data.is_edited,
            updatedAt: event.data.updated_at,
          };

          // Only add if it doesn't already exist
          const exists = this.messages().some(m => m.id === event.data.id);
          if (!exists) {
            this.messages.update(msgs => {
              // Double-check to avoid race conditions
              if (msgs.some(m => m.id === event.data.id)) {
                return msgs;
              }
              return [...msgs, newMessage];
            });
            // Chat is open — mark as read and clear separator
            if (!newMessage.isCurrentUser && !isSystem) {
              this.unreadSeparatorTimestamp.set(null);
              this.consultationService.markConsultationRead(this.consultationId)
                .pipe(takeUntil(this.destroy$))
                .subscribe();
            }
          }
        } else if (event.state === 'updated' || event.state === 'deleted') {
          this.loadMessages();
        }
      });

    this.wsService.participantJoined$
      .pipe(takeUntil(this.destroy$))
      .subscribe(event => {
        this.toasterService.show(
          'success',
          this.t.instant('consultationDetail.participantJoined'),
          this.t.instant('consultationDetail.participantJoinedMessage', {
            name: event.data.username,
          })
        );
        this.appointmentPanel()?.reload();
      });

    this.wsService.participantLeft$
      .pipe(takeUntil(this.destroy$))
      .subscribe(event => {
        this.toasterService.show(
          'warning',
          this.t.instant('consultationDetail.participantLeft'),
          this.t.instant('consultationDetail.participantLeftMessage', {
            name: event.data.username,
          })
        );
        this.appointmentPanel()?.reload();
      });

    this.wsService.appointmentUpdated$
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        this.appointmentPanel()?.reload();
      });

    this.wsService.consultationUpdated$
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        this.loadConsultation(true);
      });

    this.wsService.userOnlineStatus$
      .pipe(takeUntil(this.destroy$))
      .subscribe(event => {
        const userId = event.user_id;
        const isOnline = event.data.is_online;
        const current = this.consultation();
        if (!current) return;

        let updated = false;
        const patch = { ...current };

        if (current.created_by?.id === userId) {
          patch.created_by = { ...current.created_by, is_online: isOnline };
          updated = true;
        }
        if (current.owned_by?.id === userId) {
          patch.owned_by = { ...current.owned_by, is_online: isOnline };
          updated = true;
        }
        if (current.beneficiary?.id === userId) {
          patch.beneficiary = { ...current.beneficiary, is_online: isOnline };
          updated = true;
        }

        if (updated) {
          this.consultation.set(patch);
        }

        // Update participant online status in appointments
        const currentAppointments = this.appointments();
        let appointmentsUpdated = false;
        const updatedAppointments = currentAppointments.map(appointment => {
          const hasUser = appointment.participants.some(
            p => p.user?.id === userId
          );
          if (!hasUser) return appointment;
          appointmentsUpdated = true;
          return {
            ...appointment,
            participants: appointment.participants.map(p =>
              p.user?.id === userId
                ? { ...p, user: { ...p.user, is_online: isOnline } }
                : p
            ),
          };
        });
        if (appointmentsUpdated) {
          const panel = this.appointmentPanel();
          updatedAppointments.forEach(a => panel?.upsert(a));
        }
      });

    // Listen for call_response events from the beneficiary
    this.userWsService.callResponse$
      .pipe(takeUntil(this.destroy$))
      .subscribe(event => {
        if (event.consultation_id !== this.consultationId) return;

        if (!event.accepted) {
          this.toasterService.show(
            'warning',
            this.t.instant('consultationDetail.callDeclined'),
            this.t.instant('consultationDetail.callDeclinedMessage', { name: event.responder_name })
          );
          this.activeCallService.endCall();
        }
      });
  }

  async onSendMessage(data: SendMessageData): Promise<void> {
    let content: string | undefined = data.content;
    let attachment: File | undefined = data.attachment;
    let isEncrypted = false;
    let encryptedAttachmentMetadata: string | null = null;

    const consultation = this.consultation();
    if (consultation?.is_encrypted && !consultation.public_key) {
      console.error(
        '[encryption] consultation is_encrypted=true but no public_key on payload; refusing to send',
      );
      this.toasterService.show(
        'error',
        this.t.instant('consultationDetail.encryptionRequiredTitle'),
        this.t.instant('consultationDetail.encryptionKeyMissingMessage'),
      );
      return;
    }
    if (consultation?.is_encrypted && consultation.public_key) {
      isEncrypted = true;
      const consultPub = consultation.public_key;
      if (data.content) {
        content = await this.encryptionService.encryptString(
          data.content,
          consultPub,
        );
      }
      if (data.attachment) {
        const { blob: encryptedBlob, wrappedKey } =
          await this.encryptionService.encryptBlob(data.attachment, consultPub);
        attachment = new File(
          [encryptedBlob],
          data.attachment.name,
          { type: 'application/octet-stream' },
        );
        encryptedAttachmentMetadata =
          await this.encryptionService.encryptAttachmentMetadata(
            {
              file_name: data.attachment.name,
              mime_type: data.attachment.type,
              wrapped_key: wrappedKey,
            },
            consultPub,
          );
      }
    }

    this.consultationService
      .sendConsultationMessage(this.consultationId, {
        content,
        attachment,
        is_encrypted: isEncrypted || undefined,
        encrypted_attachment_metadata: encryptedAttachmentMetadata,
      })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          // Message will be added via WebSocket
        },
        error: error => {
          this.toasterService.show(
            'error',
            this.t.instant('consultationDetail.errorSendingMessage'),
            getErrorMessage(error)
          );
        },
      });
  }

  loadMessages(): void {
    this.currentPage = 1;
    this.consultationService
      .getConsultationMessages(this.consultationId, { page: 1 })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: async response => {
          this.hasMore.set(!!response.next);
          const currentUserId = this.currentUser()?.pk;
          const loadedMessages: Message[] = await Promise.all(
            response.results.map(async msg => {
              const isSystem = !msg.created_by;
              const isCurrentUser = isSystem
                ? false
                : msg.created_by.id === currentUserId;
              const username = isSystem
                ? ''
                : isCurrentUser
                  ? this.t.instant('consultationDetail.you')
                  : `${msg.created_by.first_name} ${msg.created_by.last_name}`.trim() ||
                    msg.created_by.email;
              const decryptedContent = await this.decryptMessageContent(
                msg.content,
                msg.is_encrypted,
              );
              const { attachment, attachmentDecrypt } =
                await this.buildAttachmentDecryptor(msg);
              return {
                id: msg.id,
                username,
                message: decryptedContent,
                timestamp: msg.created_at,
                isCurrentUser,
                isSystem,
                attachment,
                attachmentDecrypt,
                recording_url: msg.recording_url,
                isEdited: msg.is_edited,
                updatedAt: msg.updated_at,
                deletedAt: msg.deleted_at,
              };
            }),
          );
          loadedMessages.reverse();

          // Deduplicate messages by ID
          const uniqueMessages = Array.from(
            new Map(loadedMessages.map(msg => [msg.id, msg])).values()
          );
          this.messages.set(uniqueMessages);
        },
        error: error => {
          this.toasterService.show(
            'error',
            this.t.instant('consultationDetail.errorLoadingMessages'),
            getErrorMessage(error)
          );
        },
      });
  }

  onLoadMore(): void {
    if (this.isLoadingMore() || !this.hasMore()) return;

    this.isLoadingMore.set(true);
    this.currentPage++;

    this.consultationService
      .getConsultationMessages(this.consultationId, { page: this.currentPage })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: async response => {
          this.hasMore.set(!!response.next);
          const currentUserId = this.currentUser()?.pk;
          const olderMessages: Message[] = (
            await Promise.all(
              response.results.map(async msg => {
                const isSystem = !msg.created_by;
                const isCurrentUser = isSystem
                  ? false
                  : msg.created_by.id === currentUserId;
                const username = isSystem
                  ? ''
                  : isCurrentUser
                    ? this.t.instant('consultationDetail.you')
                    : `${msg.created_by.first_name} ${msg.created_by.last_name}`.trim() ||
                      msg.created_by.email;
                const decryptedContent = await this.decryptMessageContent(
                  msg.content,
                  msg.is_encrypted,
                );
                const { attachment, attachmentDecrypt } =
                  await this.buildAttachmentDecryptor(msg);
                return {
                  id: msg.id,
                  username,
                  message: decryptedContent,
                  timestamp: msg.created_at,
                  isCurrentUser,
                  isSystem,
                  attachment,
                  attachmentDecrypt,
                  recording_url: msg.recording_url,
                  isEdited: msg.is_edited,
                  updatedAt: msg.updated_at,
                  deletedAt: msg.deleted_at,
                };
              }),
            )
          ).reverse();

          // Merge and deduplicate messages
          this.messages.update(msgs => {
            const allMessages = [...olderMessages, ...msgs];
            const uniqueMessages = Array.from(
              new Map(allMessages.map(msg => [msg.id, msg])).values()
            );
            return uniqueMessages;
          });
          this.isLoadingMore.set(false);
        },
        error: error => {
          this.currentPage--;
          this.isLoadingMore.set(false);
          this.toasterService.show(
            'error',
            this.t.instant('consultationDetail.errorLoadingMessages'),
            getErrorMessage(error)
          );
        },
      });
  }

  loadConsultation(silent = false): void {
    if (!silent) {
      this.isLoadingConsultation.set(true);
    }
    this.consultationService
      .getConsultation(this.consultationId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: consultation => {
          if (!this.unreadSeparatorTimestamp()) {
            this.unreadSeparatorTimestamp.set(consultation.last_read_at || null);
          }
          this.consultation.set(consultation);
          this.isLoadingConsultation.set(false);
          if (consultation.is_encrypted) {
            this.loadConsultationKey(consultation);
          } else {
            this.loadMessages();
          }
        },
        error: error => {
          this.isLoadingConsultation.set(false);
          this.toasterService.show(
            'error',
            this.t.instant('consultationDetail.errorLoadingConsultation'),
            getErrorMessage(error)
          );
        },
      });
  }

  private async loadConsultationKey(consultation: Consultation): Promise<void> {
    // Tree navigation:
    //   1. Try every ConsultationKey row available to the current user
    //      (direct user envelope, then queue envelopes for queues they
    //      belong to). Each row holds the consultation's private key,
    //      envelope-encrypted under either the user's or the queue's pubkey.
    //   2. Decrypt the consultation private key (PEM), cache it, import as
    //      non-extractable CryptoKey for use in message decrypt.
    this.consultationPrivateKey = null;
    this.consultationPrivateKeyPem = null;
    this.chatKeyError.set(null);

    const userId = this.currentUser()?.pk;
    if (!userId) {
      return;
    }
    if (!consultation.is_encrypted) {
      return;
    }
    const privateKey = await this.encryptionService.getLocalPrivateKey(userId);
    if (!privateKey) {
      this.toasterService.show(
        'warning',
        this.t.instant('consultationDetail.encryptionKeyMissingTitle'),
        this.t.instant('consultationDetail.encryptionKeyMissingMessage'),
      );
      this.chatKeyError.set('no-local-key');
      return;
    }

    const candidateKeys = consultation.keys || [];
    let triedUserDirect = false;
    let triedQueue = false;

    for (const key of candidateKeys) {
      try {
        let consultPrivPem: string | null = null;
        if (key.user_id === userId) {
          triedUserDirect = true;
          const buf = await this.encryptionService.rsaEnvelopeDecrypt(
            key.encrypted_private_key,
            privateKey,
          );
          consultPrivPem = new TextDecoder().decode(buf);
        } else if (key.queue_id && key.queue_membership_envelope) {
          triedQueue = true;
          const queuePemBuf = await this.encryptionService.rsaEnvelopeDecrypt(
            key.queue_membership_envelope,
            privateKey,
          );
          const queuePem = new TextDecoder().decode(queuePemBuf);
          const queuePrivateKey =
            await this.encryptionService.importPrivateKey(queuePem);
          const consultPrivBuf = await this.encryptionService.rsaEnvelopeDecrypt(
            key.encrypted_private_key,
            queuePrivateKey,
          );
          consultPrivPem = new TextDecoder().decode(consultPrivBuf);
        }
        if (!consultPrivPem) continue;

        this.consultationPrivateKey =
          await this.encryptionService.importPrivateKey(consultPrivPem);
        this.consultationPrivateKeyPem = consultPrivPem;
        this.loadMessages();
        this.syncParticipantEnvelopes();
        return;
      } catch (err) {
        console.warn('Consultation key unwrap failed for entry', err);
      }
    }

    // We had at least one candidate envelope but none worked — narrow the
    // diagnosis based on which paths were attempted.
    if (candidateKeys.length > 0) {
      if (triedUserDirect && triedQueue) {
        this.chatKeyError.set('mixed');
      } else if (triedQueue) {
        this.chatKeyError.set('queue-only');
      } else if (triedUserDirect) {
        this.chatKeyError.set('user-only');
      } else {
        this.chatKeyError.set('mixed');
      }
    }
    console.warn(
      '[encryption] no readable consultation key for consultation %s',
      consultation.id,
    );
  }

  /**
   * Provision missing ConsultationKey envelopes for the consultation.
   * Wraps the in-memory consultation private key (PEM) with the public key
   * of each visible+active participant whose ConsultationKey row is still
   * missing on the server, then POSTs them to the catch-up endpoint. The
   * server only stores the wrapped envelopes; the consultation private
   * key never leaves the client in clear.
   */
  private async syncParticipantEnvelopes(): Promise<void> {
    const consultation = this.consultation();
    if (
      !consultation?.is_encrypted
      || !this.consultationPrivateKeyPem
    ) {
      return;
    }
    const privateKeyBytes = new TextEncoder().encode(
      this.consultationPrivateKeyPem,
    );
    const toProvision: ConsultationKeyInput[] = [];

    // Re-wrap the consultation private key with the consultation's queue
    // pubkey if a queue is assigned. This handles the case where the queue
    // keypair was regenerated after the consultation was created (the old
    // queue ConsultationKey row would now be undecryptable). The backend's
    // sync-consultation-keys action upserts, so resending this is
    // idempotent — stale envelopes are silently overwritten with fresh ones.
    const queue = consultation.group;
    if (queue?.id && queue.public_key) {
      try {
        const encryptedPrivate =
          await this.encryptionService.rsaEnvelopeEncrypt(
            privateKeyBytes,
            queue.public_key,
          );
        const fingerprint = queue.public_key_fingerprint
          ?? await this.encryptionService.fingerprintPublicKey(queue.public_key);
        toProvision.push({
          queue_id: queue.id,
          encrypted_private_key: encryptedPrivate,
          pubkey_fingerprint: fingerprint,
        });
      } catch (err) {
        console.warn(
          '[encryption] failed to wrap consultation key for queue',
          queue.id,
          err,
        );
      }
    }

    const participants = this.appointments().flatMap(
      appointment => appointment.participants || [],
    );
    toProvision.push(
      ...(await this.cryptoService.buildParticipantEnvelopes(
        participants,
        this.consultationPrivateKeyPem,
      )),
    );

    if (!toProvision.length) {
      return;
    }
    this.consultationService
      .syncConsultationKeys(consultation.id, toProvision)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        error: err => {
          console.warn('[encryption] sync-consultation-keys failed', err);
        },
      });
  }

  private async buildRewrappedEnvelopes(
    updateData: Partial<CreateConsultationRequest>,
  ): Promise<Partial<CreateConsultationRequest>> {
    // When the user changes beneficiary/owned_by/group on an encrypted
    // consultation, we wrap the consultation private key (in-memory PEM)
    // for each new recipient and surface them via initial_keys so the
    // server upserts the matching ConsultationKey rows.
    const consultation = this.consultation();
    if (!consultation?.is_encrypted) {
      return {};
    }
    const privPem = this.consultationPrivateKeyPem;
    if (!privPem) {
      throw new Error(
        'Cannot rewrap envelopes — consultation private key not loaded',
      );
    }
    const privBytes = new TextEncoder().encode(privPem);

    const newBeneficiaryId = updateData.beneficiary_id ?? null;
    const newOwnerId = updateData.owned_by_id ?? null;
    const newGroupId = updateData.group_id ?? null;
    const oldBeneficiaryId = consultation.beneficiary?.id ?? null;
    const oldOwnerId = consultation.owned_by?.id ?? null;
    const oldGroupId = consultation.group?.id ?? null;

    const initial_keys: ConsultationKeyInput[] = [];

    const wrapForUser = async (id: number, pubkey: string, fingerprint: string | null | undefined) => {
      const wrapped = await this.encryptionService.rsaEnvelopeEncrypt(
        privBytes,
        pubkey,
      );
      initial_keys.push({
        user_id: id,
        encrypted_private_key: wrapped,
        pubkey_fingerprint: fingerprint
          ?? await this.encryptionService.fingerprintPublicKey(pubkey),
      });
    };

    if (newBeneficiaryId !== oldBeneficiaryId && newBeneficiaryId) {
      const ben = this.selectedBeneficiary();
      if (!ben?.public_key) {
        throw new Error('New beneficiary has no public key (not provisioned yet)');
      }
      await wrapForUser(newBeneficiaryId, ben.public_key, ben.public_key_fingerprint);
    }

    if (newOwnerId !== oldOwnerId && newOwnerId) {
      const owner = this.practitionerCache.get(newOwnerId) ?? this.selectedOwner();
      if (!owner?.public_key) {
        throw new Error('New owner has no public key (not provisioned yet)');
      }
      await wrapForUser(newOwnerId, owner.public_key, owner.public_key_fingerprint);
    }

    if (newGroupId !== oldGroupId && newGroupId) {
      const queue = this.queues().find(q => q.id === newGroupId);
      if (!queue?.public_key) {
        throw new Error('New queue has no public key (not provisioned yet)');
      }
      const wrapped = await this.encryptionService.rsaEnvelopeEncrypt(
        privBytes,
        queue.public_key,
      );
      initial_keys.push({
        queue_id: newGroupId,
        encrypted_private_key: wrapped,
        pubkey_fingerprint: queue.public_key_fingerprint
          ?? await this.encryptionService.fingerprintPublicKey(queue.public_key),
      });
    }

    return initial_keys.length ? { initial_keys } : {};
  }

  private async decryptMessageContent(
    rawContent: string | null,
    isEncrypted: boolean | undefined,
  ): Promise<string> {
    if (!isEncrypted || !rawContent || !this.consultationPrivateKey) {
      return rawContent || '';
    }
    try {
      return await this.encryptionService.decryptString(
        rawContent,
        this.consultationPrivateKey,
      );
    } catch {
      return '[decryption failed]';
    }
  }

  /**
   * For an encrypted attachment, decrypt the metadata (file_name, mime_type
   * + wrapped CEK) and produce a decryptor closure that the message-list
   * can call on the encrypted blob downloaded from the server. Falls back to
   * the raw attachment when the consultation isn't encrypted.
   */
  private async buildAttachmentDecryptor(msg: ConsultationMessage): Promise<{
    attachment: ConsultationMessage['attachment'];
    attachmentDecrypt?: (encryptedBlob: Blob) => Promise<Blob>;
  }> {
    if (
      !msg.is_encrypted
      || !msg.attachment
      || !msg.encrypted_attachment_metadata
      || !this.consultationPrivateKey
    ) {
      return { attachment: msg.attachment };
    }
    try {
      const metadata = await this.encryptionService.decryptAttachmentMetadata(
        msg.encrypted_attachment_metadata,
        this.consultationPrivateKey,
      );
      const privateKey = this.consultationPrivateKey;
      const encryptionService = this.encryptionService;
      return {
        attachment: {
          file_name: metadata.file_name,
          mime_type: metadata.mime_type,
        },
        attachmentDecrypt: async (encryptedBlob: Blob): Promise<Blob> => {
          const decrypted = await encryptionService.decryptBlob(
            encryptedBlob,
            privateKey,
            metadata,
          );
          return decrypted.blob;
        },
      };
    } catch (err) {
      console.warn('Failed to decrypt attachment metadata', err);
      return { attachment: msg.attachment };
    }
  }



  loadReminders(): void {
    this.isLoadingReminders.set(true);
    this.reminderPage = 1;
    this.consultationService
      .getReminders({
        consultation: this.consultationId,
        page: 1,
        page_size: this.reminderPageSize,
      })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: response => {
          this.reminders.set(response.results);
          this.reminderTotalCount.set(response.count);
          this.hasMoreReminders.set(response.next !== null);
          this.isLoadingReminders.set(false);
        },
        error: error => {
          this.isLoadingReminders.set(false);
          this.toasterService.show(
            'error',
            this.t.instant('reminders.errorLoading'),
            getErrorMessage(error)
          );
        },
      });
  }

  loadMoreReminders(): void {
    if (this.isLoadingMoreReminders() || !this.hasMoreReminders()) return;

    this.isLoadingMoreReminders.set(true);
    this.reminderPage++;
    this.consultationService
      .getReminders({
        consultation: this.consultationId,
        page: this.reminderPage,
        page_size: this.reminderPageSize,
      })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: response => {
          this.reminders.set([...this.reminders(), ...response.results]);
          this.hasMoreReminders.set(response.next !== null);
          this.isLoadingMoreReminders.set(false);
        },
        error: error => {
          this.reminderPage--;
          this.isLoadingMoreReminders.set(false);
          this.toasterService.show(
            'error',
            this.t.instant('reminders.errorLoading'),
            getErrorMessage(error)
          );
        },
      });
  }

















  closeConsultation(): void {
    const consultation = this.consultation();
    if (!consultation) return;

    let message = this.t.instant('consultationDetail.closeConsultationMessage');
    if (this.consultationAutoDeleteHours > 0) {
      message = this.t.instant('consultationDetail.closeConsultationMessageWithDeletion', {
        hours: this.consultationAutoDeleteHours.toString()
      });
    }

    this.closeConsultationMessage.set(message);
    this.closeConsultationNotes.setValue(consultation.notes || '');
    this.showCloseConsultationModal.set(true);
  }

  confirmCloseConsultation(): void {
    const consultation = this.consultation();
    if (!consultation || this.isClosingConsultation()) return;

    const notes = this.closeConsultationNotes.value;
    const saveNotes$: Observable<Consultation | null> =
      notes !== (consultation.notes || '')
        ? this.consultationService.updateConsultation(this.consultationId, {
            notes,
          })
        : of(null);

    this.isClosingConsultation.set(true);
    saveNotes$
      .pipe(
        switchMap(() =>
          this.consultationService.closeConsultation(this.consultationId)
        ),
        takeUntil(this.destroy$)
      )
      .subscribe({
        next: () => {
          this.isClosingConsultation.set(false);
          this.showCloseConsultationModal.set(false);
          this.toasterService.show(
            'success',
            this.t.instant('consultationDetail.consultationClosed'),
            this.t.instant('consultationDetail.consultationClosedMessage')
          );
          this.router.navigate([
            `/${RoutePaths.USER}/${RoutePaths.CONSULTATIONS}`,
          ]);
        },
        error: error => {
          this.isClosingConsultation.set(false);
          this.toasterService.show(
            'error',
            this.t.instant('consultationDetail.errorClosingConsultation'),
            getErrorMessage(error)
          );
        },
      });
  }

  async reopenConsultation(): Promise<void> {
    if (!this.consultation()) return;

    const confirmed = await this.confirmationService.confirm({
      title: this.t.instant('consultationDetail.reopenConsultationTitle'),
      message: this.t.instant('consultationDetail.reopenConsultationMessage'),
      confirmText: this.t.instant('consultationDetail.reopen'),
      cancelText: this.t.instant('consultationDetail.cancel'),
      confirmStyle: 'primary',
    });

    if (confirmed) {
      this.consultationService
        .reopenConsultation(this.consultationId)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: updatedConsultation => {
            this.consultation.set(updatedConsultation);
            this.toasterService.show(
              'success',
              this.t.instant('consultationDetail.consultationReopened'),
              this.t.instant('consultationDetail.consultationReopenedMessage')
            );
          },
          error: error => {
            this.toasterService.show(
              'error',
              this.t.instant('consultationDetail.errorReopeningConsultation'),
              getErrorMessage(error)
            );
          },
        });
    }
  }

  exportPdf(): void {
    if (this.isExportingPdf()) return;

    this.isExportingPdf.set(true);
    this.consultationService
      .exportConsultationPdf(this.consultationId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (blob: Blob) => {
          const url = window.URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          const title = this.consultation()?.title;
          const filename = title
            ? `consultation_${this.consultationId}_${title.toLowerCase().replace(/\s+/g, '_')}.pdf`
            : `consultation_${this.consultationId}.pdf`;
          link.download = filename;
          link.click();
          window.URL.revokeObjectURL(url);
          this.isExportingPdf.set(false);
          this.toasterService.show(
            'success',
            this.t.instant('consultationDetail.pdfExported'),
            this.t.instant('consultationDetail.pdfExportedMessage')
          );
        },
        error: error => {
          this.isExportingPdf.set(false);
          this.toasterService.show(
            'error',
            this.t.instant('consultationDetail.exportFailed'),
            getErrorMessage(error)
          );
        },
      });
  }

  editConsultation(): void {
    const currentConsultation = this.consultation();
    if (!currentConsultation) return;

    this.editForm.patchValue({
      title: currentConsultation.title || '',
      description: currentConsultation.description || '',
      beneficiary_id: currentConsultation.beneficiary?.id || '',
      owned_by_id: currentConsultation.owned_by?.id || '',
      group_id: currentConsultation.group?.id?.toString() || '',
      visible_by_patient: currentConsultation.visible_by_patient ?? true,
    });

    // Build custom fields form controls
    if (!this.editForm.get('custom_fields')) {
      const group: Record<string, any> = {};
      this.customFields().forEach(field => {
        group[field.id.toString()] = [''];
      });
      this.editForm.addControl('custom_fields', this.fb.group(group));
    }
    if (currentConsultation.custom_fields?.length) {
      const cfValues: Record<string, string> = {};
      currentConsultation.custom_fields.forEach(cf => {
        cfValues[cf.field.toString()] = cf.value || '';
      });
      this.editForm.get('custom_fields')?.patchValue(cfValues);
    }

    if (currentConsultation.beneficiary) {
      const bUser = {
        pk: currentConsultation.beneficiary.id,
        email: currentConsultation.beneficiary.email,
        first_name: currentConsultation.beneficiary.first_name,
        last_name: currentConsultation.beneficiary.last_name,
      } as IUser;
      this.selectedBeneficiary.set(bUser);
    } else {
      this.selectedBeneficiary.set(null);
    }

    if (currentConsultation.owned_by) {
      const oUser = {
        pk: currentConsultation.owned_by.id,
        email: currentConsultation.owned_by.email,
        first_name: currentConsultation.owned_by.first_name,
        last_name: currentConsultation.owned_by.last_name,
      } as IUser;
      this.selectedOwner.set(oUser);
      this.practitionerCache.set(oUser.pk, oUser);
      this.ownerInitialOption.set(this.userToSelectOption(oUser));
    } else {
      this.selectedOwner.set(null);
      this.ownerInitialOption.set(null);
    }

    this.isExternalBeneficiary.set(false);
    this.externalBeneficiaryErrors.set({});
    this.isEditMode.set(true);
  }

  cancelEdit(): void {
    this.isEditMode.set(false);
    this.selectedBeneficiary.set(null);
    this.selectedOwner.set(null);
    this.ownerInitialOption.set(null);
    this.isExternalBeneficiary.set(false);
    this.externalBeneficiaryErrors.set({});
  }

  onBeneficiarySelection(selection: ContactSelection | null): void {
    this.isExternalBeneficiary.set(selection?.kind === 'guest');
    this.selectedBeneficiary.set(
      selection?.kind === 'user' ? selection.user : null
    );
  }

  async saveConsultationChanges(): Promise<void> {
    if (!this.consultationId) return;

    // Validate the external beneficiary contact if that mode is active.
    let temporaryBeneficiary: ITemporaryParticipant | null = null;
    if (this.isExternalBeneficiary()) {
      const picker = this.beneficiaryPickerRef();
      picker?.markAllTouched();
      if (!picker || !picker.isValid()) return;
      temporaryBeneficiary = picker.buildGuestPayload();
      if (!temporaryBeneficiary) return;
    }

    this.isSavingConsultation.set(true);
    const formValue = this.editForm.value;

    const cfGroup = this.editForm.get('custom_fields');
    const customFieldsPayload = cfGroup
      ? Object.entries(cfGroup.value)
          .filter(
            ([_, value]) =>
              value !== '' && value !== null && value !== undefined
          )
          .map(([fieldId, value]) => ({
            field: parseInt(fieldId, 10),
            value: value as string | null,
          }))
      : [];

    const updateData: Partial<CreateConsultationRequest> = {
      title: formValue.title || null,
      description: formValue.description || null,
      owned_by_id: formValue.owned_by_id ? Number(formValue.owned_by_id) : null,
      group_id: formValue.group_id ? Number(formValue.group_id) : null,
      visible_by_patient: formValue.visible_by_patient,
      custom_fields: customFieldsPayload,
    };
    if (temporaryBeneficiary) {
      updateData.temporary_beneficiary = temporaryBeneficiary;
    } else {
      updateData.beneficiary_id = formValue.beneficiary_id
        ? Number(formValue.beneficiary_id)
        : null;
    }

    try {
      const rewrap = await this.buildRewrappedEnvelopes(updateData);
      Object.assign(updateData, rewrap);
    } catch (err) {
      this.isSavingConsultation.set(false);
      this.toasterService.show(
        'error',
        this.t.instant('consultationDetail.updateFailed'),
        (err as Error).message,
      );
      return;
    }

    this.consultationService
      .updateConsultation(this.consultationId, updateData)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: updatedConsultation => {
          this.consultation.set(updatedConsultation);
          this.isSavingConsultation.set(false);
          this.isEditMode.set(false);
          this.toasterService.show(
            'success',
            this.t.instant('consultationDetail.consultationUpdated'),
            this.t.instant('consultationDetail.consultationUpdatedMessage')
          );
        },
        error: error => {
          this.isSavingConsultation.set(false);
          const nested = error?.error?.temporary_beneficiary;
          if (nested && typeof nested === 'object') {
            this.externalBeneficiaryErrors.set(
              nested as Record<string, string[]>
            );
          }
          this.toasterService.show(
            'error',
            this.t.instant('consultationDetail.updateFailed'),
            getErrorMessage(error),
            {
              trace: JSON.stringify(error.error, null, 2),
            }
          );
        },
      });
  }
  getUserDisplayName(participant: Participant): string {
    if (participant.user) {
      const fullName =
        `${participant.user.first_name || ''} ${participant.user.last_name || ''}`.trim();
      return (
        fullName ||
        participant.user.email ||
        this.t.instant('consultationDetail.unknown')
      );
    }
    return this.t.instant('consultationDetail.unknown');
  }

  /**
   * Secondary line of an "actor" cell. The e-mail is the natural sub-line, but
   * a contact without a name already shows it as the main value — in that case
   * fall back to how they are reached (timezone, language, channel).
   */
  getUserSubLine(user: User | null | undefined, displayName: string): string {
    if (!user) return '';
    if (user.email && user.email !== displayName) return user.email;
    return [
      user.timezone,
      user.preferred_language?.toUpperCase(),
      user.communication_method,
    ]
      .filter(Boolean)
      .join(' · ');
  }

  getBeneficiaryDisplayName(): string {
    const beneficiary = this.consultation()?.beneficiary;
    if (!beneficiary) return this.t.instant('consultationDetail.noBeneficiary');

    const currentUser = this.currentUser();
    if (currentUser && beneficiary.id === currentUser.pk) {
      return this.t.instant('userSearchSelect.me');
    }

    const firstName = beneficiary.first_name?.trim() || '';
    const lastName = beneficiary.last_name?.trim() || '';
    const fullName = `${firstName} ${lastName}`.trim();

    return (
      fullName ||
      beneficiary.email ||
      this.t.instant('consultationDetail.unknownPatient')
    );
  }

  getOwnerDisplayName(): string {
    const owner = this.consultation()?.owned_by;
    if (!owner) return '';

    const currentUser = this.currentUser();
    if (currentUser && owner.id === currentUser.pk) {
      return this.t.instant('userSearchSelect.me');
    }

    const firstName = owner.first_name?.trim() || '';
    const lastName = owner.last_name?.trim() || '';
    return `${firstName} ${lastName}`.trim();
  }

  isBeneficiaryCurrentUser(): boolean {
    const beneficiary = this.consultation()?.beneficiary;
    const currentUser = this.currentUser();
    return !!(beneficiary && currentUser && beneficiary.id === currentUser.pk);
  }

  isOwnerCurrentUser(): boolean {
    const owner = this.consultation()?.owned_by;
    const currentUser = this.currentUser();
    return !!(owner && currentUser && owner.id === currentUser.pk);
  }

  getCreatedByDisplayName(): string {
    const createdBy = this.consultation()?.created_by;
    if (!createdBy) return '';

    const currentUser = this.currentUser();
    if (currentUser && createdBy.id === currentUser.pk) {
      return this.t.instant('userSearchSelect.me');
    }

    const firstName = createdBy.first_name?.trim() || '';
    const lastName = createdBy.last_name?.trim() || '';
    return `${firstName} ${lastName}`.trim();
  }

  isCreatedByCurrentUser(): boolean {
    const createdBy = this.consultation()?.created_by;
    const currentUser = this.currentUser();
    return !!(createdBy && currentUser && createdBy.id === currentUser.pk);
  }



  callBeneficiary(): void {
    if (this.isCallingBeneficiary() || this.activeCallService.hasActiveCall) {
      return;
    }

    const upcoming = this.upcomingAppointment();
    if (upcoming) {
      // If appointment has more than just patient + practitioner, show modal
      if (upcoming.participants.length > 2) {
        this.showCallAppointmentModal.set(true);
        return;
      }
    }

    this.doCallBeneficiary();
  }

  onCallModalJoinAppointment(): void {
    this.showCallAppointmentModal.set(false);
    const upcoming = this.upcomingAppointment();
    if (upcoming) {
      this.appointmentPanel()?.joinVideoCall(upcoming.id);
    }
  }

  onCallModalCallOnly(): void {
    this.showCallAppointmentModal.set(false);
    this.doCallBeneficiary();
  }

  private doCallBeneficiary(): void {
    this.isCallingBeneficiary.set(true);
    this.consultationService.callBeneficiary(this.consultationId).subscribe({
      next: (config) => {
        this.activeCallService.startCall({
          consultationId: this.consultationId,
          videoCallConfig: config,
        });
        this.isCallingBeneficiary.set(false);
      },
      error: () => {
        this.isCallingBeneficiary.set(false);
        this.toasterService.show('error', this.t.instant('consultationDetail.error'), this.t.instant('consultationDetail.callFailed'));
      },
    });
  }


  goBack(): void {
    this.location.back();
  }

  openCreateAppointmentModal(): void {
    this.editingAppointment.set(null);
    this.showCreateAppointmentModal.set(true);
  }

  openEditAppointmentModal(appointment: Appointment): void {
    this.editingAppointment.set(appointment);
    this.showCreateAppointmentModal.set(true);
  }

  closeCreateAppointmentModal(): void {
    this.showCreateAppointmentModal.set(false);
    this.editingAppointment.set(null);
  }

  openCreateReminderModal(): void {
    this.editingReminder.set(null);
    this.showCreateReminderModal.set(true);
  }

  openEditReminderModal(reminder: Reminder): void {
    this.editingReminder.set(reminder);
    this.showCreateReminderModal.set(true);
  }

  closeCreateReminderModal(): void {
    this.showCreateReminderModal.set(false);
    this.editingReminder.set(null);
  }

  onReminderCreated(): void {
    this.showCreateReminderModal.set(false);
    this.editingReminder.set(null);
    this.loadReminders();
  }

  onReminderUpdated(): void {
    this.showCreateReminderModal.set(false);
    this.editingReminder.set(null);
    this.loadReminders();
  }

  async deleteReminder(reminder: Reminder): Promise<void> {
    const confirmed = await this.confirmationService.confirm({
      title: this.t.instant('reminders.deleteTitle'),
      message: this.t.instant('reminders.deleteMessage'),
      confirmText: this.t.instant('reminders.delete'),
      cancelText: this.t.instant('reminders.cancel'),
      confirmStyle: 'danger',
    });

    if (!confirmed) return;

    this.consultationService
      .deleteReminder(reminder.id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.reminders.set(
            this.reminders().filter(r => r.id !== reminder.id)
          );
          this.toasterService.show(
            'success',
            this.t.instant('reminders.deleted')
          );
        },
        error: error => {
          this.toasterService.show(
            'error',
            this.t.instant('reminders.errorDeleting'),
            getErrorMessage(error)
          );
        },
      });
  }

  onAppointmentsLoaded(appointments: Appointment[]): void {
    this.appointments.set(appointments);

    if (this.pendingHighlightAppointmentId !== null) {
      const id = this.pendingHighlightAppointmentId;
      this.pendingHighlightAppointmentId = null;
      this.appointmentPanel()?.highlight(id);
    }
    this.checkPendingJoin();
  }

  markAppointmentAsLocallyModified(appointmentId: number): void {
    this.recentlyModifiedAppointmentIds.add(appointmentId);
    setTimeout(() => {
      this.recentlyModifiedAppointmentIds.delete(appointmentId);
    }, 5000);
  }

  onAppointmentCreated(appointment: Appointment): void {
    if (this.appointments().some(a => a.id === appointment.id)) {
      return;
    }
    this.appointmentPanel()?.upsert(appointment);
    this.markAppointmentAsLocallyModified(appointment.id);
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { appointmentId: appointment.id },
      queryParamsHandling: 'merge',
    });
    this.syncParticipantEnvelopes();
  }

  onAppointmentUpdated(updatedAppointment: Appointment): void {
    this.appointmentPanel()?.upsert(updatedAppointment);
    this.markAppointmentAsLocallyModified(updatedAppointment.id);
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { appointmentId: updatedAppointment.id },
      queryParamsHandling: 'merge',
    });
    this.syncParticipantEnvelopes();
  }

  getParticipantInitials(participant: Participant): string {
    if (participant.user) {
      const first = participant.user.first_name?.charAt(0) || '';
      const last = participant.user.last_name?.charAt(0) || '';
      if (first || last) {
        return (first + last).toUpperCase();
      }
      if (participant.user.email) {
        return participant.user.email.charAt(0).toUpperCase();
      }
    }
    return '?';
  }

  getLanguageLabel(code: string): string {
    const languages: Record<string, string> = {
      en: this.t.instant('consultationDetail.languageEnglish'),
      de: this.t.instant('consultationDetail.languageGerman'),
      fr: this.t.instant('consultationDetail.languageFrench'),
    };
    return languages[code] || code;
  }

  onEditMessage(data: EditMessageData): void {
    this.consultationService
      .updateConsultationMessage(data.messageId, data.content)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: updatedMessage => {
          this.messages.update(msgs =>
            msgs.map(m =>
              m.id === data.messageId
                ? {
                    ...m,
                    message: updatedMessage.content || '',
                    isEdited: updatedMessage.is_edited,
                    updatedAt: updatedMessage.updated_at,
                  }
                : m
            )
          );
          this.toasterService.show(
            'success',
            this.t.instant('consultationDetail.messageUpdated'),
            this.t.instant('consultationDetail.messageUpdatedMessage')
          );
        },
        error: error => {
          this.toasterService.show(
            'error',
            this.t.instant('consultationDetail.errorUpdatingMessage'),
            getErrorMessage(error)
          );
        },
      });
  }

  onDeleteMessage(data: DeleteMessageData): void {
    this.consultationService
      .deleteConsultationMessage(data.messageId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: deletedMessage => {
          this.messages.update(msgs =>
            msgs.map(m =>
              m.id === data.messageId
                ? {
                    ...m,
                    message: '',
                    attachment: null,
                    deletedAt: deletedMessage.deleted_at,
                  }
                : m
            )
          );
          this.toasterService.show(
            'success',
            this.t.instant('consultationDetail.messageDeleted'),
            this.t.instant('consultationDetail.messageDeletedMessage')
          );
        },
        error: error => {
          this.toasterService.show(
            'error',
            this.t.instant('consultationDetail.errorDeletingMessage'),
            getErrorMessage(error)
          );
        },
      });
  }











  formatConsultationId(id: number): string {
    return `#${String(id).padStart(6, '0')}`;
  }

  hasBeneficiaryManualLink(): boolean {
    const beneficiary = this.consultation()?.beneficiary;
    if (!beneficiary) return false;
    // A manual (copy-it-yourself) link is only needed when no channel can
    // deliver the access link automatically: manual communication, or neither
    // email nor phone. An SMS/WhatsApp contact receives the link in the message.
    return (
      beneficiary.communication_method === 'manual' ||
      (!beneficiary.email && !beneficiary.mobile_phone_number)
    );
  }

  openBeneficiaryLinkModal(): void {
    const beneficiary = this.consultation()?.beneficiary;
    if (!beneficiary?.id) return;

    this.beneficiaryLinkCopied.set(false);
    this.showBeneficiaryLinkModal.set(true);

    if (this.beneficiaryAccessUrl()) return;

    this.loadingBeneficiaryAccessUrl.set(true);
    this.consultationService.getPatientAccessUrl(beneficiary.id).subscribe({
      next: response => {
        this.beneficiaryAccessUrl.set(response.access_url);
        this.beneficiaryLinkExpiresAt.set(response.expires_at);
        this.loadingBeneficiaryAccessUrl.set(false);
      },
      error: () => {
        this.loadingBeneficiaryAccessUrl.set(false);
        this.toasterService.show('error', this.t.instant('participantItem.errorLoadingLink'));
        this.closeBeneficiaryLinkModal();
      },
    });
  }

  closeBeneficiaryLinkModal(): void {
    this.showBeneficiaryLinkModal.set(false);
  }

  copyBeneficiaryLink(): void {
    const link = this.beneficiaryAccessUrl();
    if (!link) return;
    navigator.clipboard.writeText(link).then(() => {
      this.beneficiaryLinkCopied.set(true);
      this.toasterService.show('success', this.t.instant('participantItem.linkCopied'));
    });
  }
}
