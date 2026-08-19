import {
  Input,
  inject,
  signal,
  Output,
  OnInit,
  OnDestroy,
  Component,
  ViewChild,
  forwardRef,
  ElementRef,
  EventEmitter,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  FormGroup,
  FormBuilder,
  FormControl,
  ReactiveFormsModule,
  NG_VALUE_ACCESSOR,
  ControlValueAccessor,
} from '@angular/forms';
import { Subject, debounceTime, takeUntil } from 'rxjs';
import { TranslatePipe } from '@ngx-translate/core';

import { Auth } from '../../../core/services/auth';
import { UserService } from '../../../core/services/user.service';
import { TranslationService } from '../../../core/services/translation.service';
import { ITemporaryParticipant } from '../../../core/models/consultation';
import { IUser } from '../../../modules/user/models/user';
import { AddEditPatient } from '../../../modules/user/components/add-edit-patient/add-edit-patient';

import { Svg } from '../../ui-components/svg/svg';
import { Select } from '../../ui-components/select/select';
import { Input as InputComponent } from '../../ui-components/input/input';
import { Checkbox } from '../../ui-components/checkbox/checkbox';
import { Loader } from '../loader/loader';
import { ModalComponent } from '../modal/modal.component';
import { SelectOption } from '../../models/select';
import { ContactChannel, ContactSelection } from '../../models/contact-picker';
import { TIMEZONE_OPTIONS } from '../../constants/timezone';

/** Languages a temporary contact can be invited in. */
const GUEST_LANGUAGES = ['fr', 'en', 'de'] as const;

/** Feeds unique input ids so the label can be associated with the field. */
let nextPickerId = 0;

/** Keep in sync with the .dropdown max-height in the stylesheet. */
const DROPDOWN_MAX_HEIGHT = 320;

/**
 * Single field used everywhere a beneficiary or a contact is picked.
 *
 * One search box replaces the former "existing user / temporary guest" tabs:
 * matching accounts come up as you type, and anything the backend does not
 * know yet can be invited straight from the result list. The channel is
 * deduced from what was typed (e-mail, mobile number, or nothing at all for a
 * link handed over manually), so no contact-method picker is needed.
 *
 * Implements ControlValueAccessor over the selected account pk, so it drops
 * into the existing `beneficiary_id` / `recipient_id` form controls. A
 * temporary contact leaves that value null: hosts read `buildGuestPayload()`
 * (or listen to `selectionChange`) and post it as `temporary_beneficiary` /
 * `temporary_participant`.
 */
@Component({
  selector: 'app-contact-picker',
  templateUrl: './contact-picker.html',
  styleUrl: './contact-picker.scss',
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => ContactPicker),
      multi: true,
    },
  ],
  imports: [
    Svg,
    Select,
    Loader,
    Checkbox,
    CommonModule,
    InputComponent,
    ModalComponent,
    AddEditPatient,
    ReactiveFormsModule,
    TranslatePipe,
  ],
})
export class ContactPicker implements OnInit, OnDestroy, ControlValueAccessor {
  @ViewChild('searchWrapper') searchWrapper?: ElementRef<HTMLDivElement>;

  @Input() label = '';
  @Input() placeholder = '';
  @Input() required = false;
  /** Line shown under the field when nothing is selected yet. */
  @Input() helperText = '';
  @Input() meUser: IUser | null = null;
  /** Account to show as already selected (edit mode). */
  @Input() set initialUser(user: IUser | null) {
    this._initialUser = user;
    // Hosts resolve the account asynchronously: adopt it as long as the
    // practitioner has not picked something else in the meantime.
    if (user && !this.guestChannel()) {
      this.selectedUser.set(user);
    }
  }
  get initialUser(): IUser | null {
    return this._initialUser;
  }
  /** Temporary contact to show as already selected (edit mode). */
  @Input() initialGuest: ITemporaryParticipant | null = null;
  /** Restrict the search to practitioners. */
  @Input() onlyPractitioners = false;
  /** Allow inviting someone who has no account yet. */
  @Input() allowGuests = true;
  /** Add the "can read the follow-up messages" checkbox to the selection. */
  @Input() showVisibility = false;
  /** Onboarding wizard: pulse the search field. */
  @Input() highlightSearch = false;
  /** Onboarding wizard: pulse the invitation details panel. */
  @Input() highlightDetails = false;
  /** Onboarding wizard: pulse the follow-up visibility checkbox. */
  @Input() highlightVisibility = false;
  /** Backend field errors keyed by contact field (email/mobile_phone_number). */
  @Input() set backendErrors(errors: Record<string, string[]>) {
    this._backendErrors.set(errors || {});
  }

  @Output() selectionChange = new EventEmitter<ContactSelection | null>();
  @Output() userSelected = new EventEmitter<IUser | null>();

  private destroy$ = new Subject<void>();
  private searchSubject = new Subject<string>();
  private fb = inject(FormBuilder);
  private authService = inject(Auth);
  private userService = inject(UserService);
  private t = inject(TranslationService);

  query = signal('');
  results = signal<IUser[]>([]);
  isLoading = signal(false);
  isOpen = signal(false);
  selectedUser = signal<IUser | null>(null);
  guestChannel = signal<ContactChannel | null>(null);
  guestEmail = signal('');
  guestPhone = signal('');
  detailsOpen = signal(false);
  addAccountModalOpen = signal(false);
  newAccountName = signal('');
  availableCommunicationMethods = signal<string[]>([]);
  dropdownStyle = signal<{
    top?: string;
    bottom?: string;
    left: string;
    width: string;
  }>({ top: '0', left: '0', width: '0' });

  readonly inputId = `contact-picker-${nextPickerId++}`;
  detailsForm!: FormGroup;
  visibilityControl = new FormControl<boolean>(true);
  timezoneOptions: SelectOption[] = TIMEZONE_OPTIONS;

  private _initialUser: IUser | null = null;
  private _backendErrors = signal<Record<string, string[]>>({});
  private onChange: (value: number | null) => void = () => undefined;
  private onTouched: () => void = () => undefined;

  ngOnInit(): void {
    this.initDetailsForm();
    this.loadConfig();

    if (this._initialUser) {
      this.selectedUser.set(this._initialUser);
    } else if (this.initialGuest) {
      this.applyGuest(this.initialGuest);
    }

    this.searchSubject
      .pipe(debounceTime(300), takeUntil(this.destroy$))
      .subscribe(query => this.search(query));

    this.detailsForm.valueChanges
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        if (Object.keys(this._backendErrors()).length > 0) {
          this._backendErrors.set({});
        }
        this.emitSelection();
      });

    this.visibilityControl.valueChanges
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => this.emitSelection());

    // The dropdown is fixed-positioned to escape modal clipping, so it has to
    // follow the field when any ancestor scrolls.
    window.addEventListener('scroll', this.updateDropdownPosition, true);
    window.addEventListener('resize', this.updateDropdownPosition);
  }

  ngOnDestroy(): void {
    window.removeEventListener('scroll', this.updateDropdownPosition, true);
    window.removeEventListener('resize', this.updateDropdownPosition);
    this.destroy$.next();
    this.destroy$.complete();
  }

  // --- Derived state -------------------------------------------------------

  get hasSelection(): boolean {
    return !!this.selectedUser() || !!this.guestChannel();
  }

  get isGuest(): boolean {
    return !this.selectedUser() && !!this.guestChannel();
  }

  /** An invitation that gets sent: green, like the "Invite …" result row. */
  get isInvitedGuest(): boolean {
    return this.isGuest && this.guestChannel() !== 'manual';
  }

  /** A link the practitioner hands over: amber, like its link glyph. */
  get isLinkGuest(): boolean {
    return this.isGuest && this.guestChannel() === 'manual';
  }

  /** Channel deduced from the current query, null when it is a plain name. */
  get detectedChannel(): ContactChannel | null {
    return this.detectChannel(this.query());
  }

  get canInvite(): boolean {
    const channel = this.detectedChannel;
    return (
      this.allowGuests &&
      channel !== null &&
      this.supportedChannels.has(channel) &&
      this.canOfferGuestActions
    );
  }

  /**
   * Channels the organisation can actually deliver an access link over, per
   * the /config/ endpoint. "manual" is never a messaging provider: the
   * practitioner hands the link over, so it is always available.
   */
  private get supportedChannels(): Set<ContactChannel> {
    const methods = this.availableCommunicationMethods();
    const channels = new Set<ContactChannel>(['manual']);
    if (methods.includes('email')) channels.add('email');
    if (methods.includes('sms') || methods.includes('whatsapp')) {
      channels.add('sms');
    }
    return channels;
  }

  /** Wording of the dropdown hint, matching the channels actually offered. */
  get dropdownHintKey(): string {
    if (!this.allowGuests) return 'contactPicker.dropdownHintSearchOnly';
    return `contactPicker.dropdownHint${this.channelsSuffix}`;
  }

  private get channelsSuffix(): string {
    const email = this.supportedChannels.has('email');
    const sms = this.supportedChannels.has('sms');
    if (email && sms) return '';
    if (email) return 'Email';
    if (sms) return 'Sms';
    return 'LinkOnly';
  }

  /**
   * Kept rendered whether or not the dropdown is open: hiding it on focus
   * would shrink the surrounding modal and move the field out from under the
   * fixed-positioned dropdown.
   */
  get helperMessage(): string {
    if (this.helperText) return this.helperText;
    if (!this.allowGuests) return '';
    return this.t.instant(`contactPicker.idleHelper${this.channelsSuffix}`);
  }

  get canCreateContact(): boolean {
    return (
      this.allowGuests &&
      this.query().trim().length > 0 &&
      this.canOfferGuestActions
    );
  }

  /** True when "create the contact" opens the full form instead of a guest. */
  get createContactOpensForm(): boolean {
    return this.detectedChannel !== null;
  }

  /**
   * Creating a contact only makes sense once the search has settled and none
   * of the accounts it returned already owns the typed address or number.
   */
  private get canOfferGuestActions(): boolean {
    if (this.isLoading()) return false;
    const query = this.query().trim().toLowerCase();
    if (!query) return true;
    const digits = this.phoneDigits(query);
    return !this.results().some(user => {
      if ((user.email || '').trim().toLowerCase() === query) return true;
      return !!digits && this.phoneDigits(user.mobile_phone_number) === digits;
    });
  }

  get inviteHint(): string {
    if (this.detectedChannel === 'email') {
      return this.t.instant('contactPicker.inviteByEmailHint');
    }
    if (this.detectedChannel === 'sms') {
      return this.t.instant('contactPicker.inviteBySmsHint');
    }
    return '';
  }

  get selectedName(): string {
    const user = this.selectedUser();
    if (user) return this.displayName(user);

    const v = this.detailsForm.getRawValue();
    const name = `${v.first_name || ''} ${v.last_name || ''}`.trim();
    if (name) return name;
    return (
      this.guestEmail() ||
      this.guestPhone() ||
      this.t.instant('contactPicker.guestWithoutContact')
    );
  }

  get selectedInitials(): string {
    const user = this.selectedUser();
    if (user) return this.initials(user);
    return (this.selectedName.charAt(0) || '?').toUpperCase();
  }

  /**
   * A contact with neither name nor address has no meaningful initial: show
   * the link glyph instead, matching its "link only" badge.
   */
  get showLinkAvatar(): boolean {
    if (this.selectedUser() || this.guestChannel() !== 'manual') return false;
    if (this.guestEmail() || this.guestPhone()) return false;
    const v = this.detailsForm.getRawValue();
    return !v.first_name && !v.last_name;
  }

  get selectedTag(): string {
    if (this.selectedUser()) {
      return this.t.instant('contactPicker.tagAccount');
    }
    if (this.guestChannel() === 'manual') {
      return this.t.instant('contactPicker.tagLinkOnly');
    }
    return this.t.instant('contactPicker.tagGuest');
  }

  get selectedMeta(): string {
    const user = this.selectedUser();
    if (user) {
      return [user.email, user.mobile_phone_number].filter(Boolean).join(' · ');
    }
    const channel = this.guestChannel();
    if (channel === 'email') {
      return `${this.guestEmail()} · ${this.t.instant('contactPicker.linkSentByEmail')}`;
    }
    if (channel === 'sms') {
      return `${this.guestPhone()} · ${this.t.instant(
        this.isWhatsAppDelivery
          ? 'contactPicker.linkSentByWhatsApp'
          : 'contactPicker.linkSentBySms'
      )}`;
    }
    return this.t.instant('contactPicker.linkToShareYourself');
  }

  /** The organisation may deliver the link over WhatsApp rather than SMS. */
  private get isWhatsAppDelivery(): boolean {
    const method =
      this.detailsForm.get('communication_method')?.value ||
      this.communicationMethods[0]?.value;
    return method === 'whatsapp';
  }

  get detailsTitle(): string {
    return this.detailsOpen()
      ? this.t.instant('contactPicker.invitationDetails')
      : this.t.instant('contactPicker.addNameLanguage');
  }

  /** One-line recap of the invitation settings, shown on the folded header. */
  get detailsMeta(): string {
    const v = this.detailsForm.getRawValue();
    const language = this.languageOptions.find(
      option => option.value === v.preferred_language
    )?.label;
    const channel = this.guestChannel();
    const delivery =
      channel === 'email'
        ? this.t.instant('contactPicker.deliveryEmail')
        : channel === 'sms'
          ? this.t.instant(
              this.isWhatsAppDelivery
                ? 'contactPicker.deliveryWhatsApp'
                : 'contactPicker.deliverySms'
            )
          : this.t.instant('contactPicker.deliveryManual');
    return [language, v.timezone, delivery].filter(Boolean).join(' · ');
  }

  get languageOptions(): SelectOption[] {
    return GUEST_LANGUAGES.map(code => ({
      value: code,
      label: this.t.instant(`contactPicker.language.${code}`),
    }));
  }

  get communicationMethods(): SelectOption[] {
    const methods = this.availableCommunicationMethods();
    const options: SelectOption[] = [];
    if (methods.includes('sms')) {
      options.push({ value: 'sms', label: this.t.instant('appointmentForm.sms') });
    }
    if (methods.includes('whatsapp')) {
      options.push({
        value: 'whatsapp',
        label: this.t.instant('appointmentForm.whatsApp'),
      });
    }
    return options;
  }

  /** Only worth asking when the organisation offers both SMS and WhatsApp. */
  get showCommunicationMethodField(): boolean {
    return this.guestChannel() === 'sms' && this.communicationMethods.length > 1;
  }

  get contactError(): string {
    const errors = this._backendErrors();
    const key = this.guestChannel() === 'sms' ? 'mobile_phone_number' : 'email';
    return errors[key]?.[0] || errors['non_field_errors']?.[0] || '';
  }

  // --- Search --------------------------------------------------------------

  onQueryInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value || '';
    this.query.set(value);
    this.isLoading.set(value.trim().length > 0);
    this.isOpen.set(true);
    this.updateDropdownPosition();
    requestAnimationFrame(this.updateDropdownPosition);
    this.searchSubject.next(value);
  }

  onFocus(): void {
    this.updateDropdownPosition();
    this.isOpen.set(true);
    // Re-measure once the dropdown is laid out, in case rendering it reflowed
    // the container it sits in.
    requestAnimationFrame(this.updateDropdownPosition);
  }

  closeDropdown(): void {
    this.isOpen.set(false);
    this.onTouched();
  }

  private search(query: string): void {
    const trimmed = query.trim();
    if (!trimmed) {
      this.results.set([]);
      this.isLoading.set(false);
      return;
    }

    this.isLoading.set(true);
    this.userService
      .searchUsers(
        trimmed,
        1,
        20,
        undefined,
        undefined,
        this.onlyPractitioners ? true : undefined
      )
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: response => {
          this.results.set(response.results);
          this.isLoading.set(false);
        },
        error: () => {
          this.results.set([]);
          this.isLoading.set(false);
        },
      });
  }

  private updateDropdownPosition = (): void => {
    const wrapper = this.searchWrapper?.nativeElement;
    if (!wrapper) return;
    const rect = wrapper.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    // Flip above the field when the dropdown would run past the viewport.
    if (spaceBelow < DROPDOWN_MAX_HEIGHT && rect.top > spaceBelow) {
      this.dropdownStyle.set({
        bottom: `${window.innerHeight - rect.top + 4}px`,
        left: `${rect.left}px`,
        width: `${rect.width}px`,
      });
      return;
    }
    this.dropdownStyle.set({
      top: `${rect.bottom + 4}px`,
      left: `${rect.left}px`,
      width: `${rect.width}px`,
    });
  };

  // --- Selection -----------------------------------------------------------

  pickUser(user: IUser): void {
    this.selectedUser.set(user);
    this.guestChannel.set(null);
    this.guestEmail.set('');
    this.guestPhone.set('');
    this.detailsOpen.set(false);
    this.resetQuery();
    this.onChange(user.pk);
    this.onTouched();
    this.userSelected.emit(user);
    this.emitSelection();
  }

  /** Invite the typed e-mail or mobile number: an access link will be sent. */
  invite(): void {
    const channel = this.detectedChannel;
    if (!channel || !this.supportedChannels.has(channel)) return;
    this.startGuest(channel, this.query().trim());
  }

  /**
   * With a real address or number in hand there is nothing to hand over by
   * hand: open the contact form so a proper record is created. A plain name
   * has no channel, so it becomes a contact whose link is shared manually.
   */
  createContact(): void {
    if (this.detectedChannel) {
      this.openAddAccountModal();
      return;
    }
    this.startGuest('manual', this.query().trim());
  }

  /** Create a contact with no e-mail nor mobile: the link is copied by hand. */
  createLinkOnly(): void {
    this.startGuest('manual', '');
  }

  private startGuest(channel: ContactChannel, raw: string): void {
    const detected = this.detectChannel(raw);
    this.selectedUser.set(null);
    this.guestChannel.set(channel);
    this.guestEmail.set(detected === 'email' ? raw : '');
    this.guestPhone.set(detected === 'sms' ? raw : '');

    const patch: Record<string, unknown> = {
      communication_method: this.defaultCommunicationMethod(channel),
    };
    if (!detected && raw) {
      const [first, ...rest] = raw.split(/\s+/);
      patch['first_name'] = first;
      patch['last_name'] = rest.join(' ');
    }
    this.detailsForm.patchValue(patch, { emitEvent: false });

    // A link-only contact has nothing but its name: open the panel so the
    // practitioner can fill it in right away.
    this.detailsOpen.set(channel === 'manual');
    this.resetQuery();
    this.onChange(null);
    this.onTouched();
    this.userSelected.emit(null);
    this.emitSelection();
  }

  /** Back to the search field, dropping whatever was selected. */
  clearSelection(): void {
    this.selectedUser.set(null);
    this.guestChannel.set(null);
    this.guestEmail.set('');
    this.guestPhone.set('');
    this.detailsOpen.set(false);
    this._backendErrors.set({});
    this.detailsForm.reset(this.defaultDetails(), { emitEvent: false });
    this.resetQuery();
    this.onChange(null);
    this.onTouched();
    this.userSelected.emit(null);
    this.emitSelection();
  }

  toggleDetails(): void {
    this.detailsOpen.update(open => !open);
  }

  openAddAccountModal(): void {
    this.newAccountName.set(this.query().trim());
    this.isOpen.set(false);
    this.addAccountModalOpen.set(true);
  }

  closeAddAccountModal(): void {
    this.addAccountModalOpen.set(false);
    this.newAccountName.set('');
  }

  onAccountCreated(user: IUser): void {
    this.closeAddAccountModal();
    this.pickUser(user);
  }

  // --- Public API for hosts ------------------------------------------------

  isValid(): boolean {
    if (this.selectedUser()) return true;
    if (this.guestChannel()) return this.buildGuestPayload() !== null;
    return !this.required;
  }

  markAllTouched(): void {
    Object.keys(this.detailsForm.controls).forEach(key => {
      this.detailsForm.get(key)?.markAsTouched();
    });
    this.onTouched();
  }

  /** Selected account, or null when a temporary contact was described. */
  currentUser(): IUser | null {
    return this.selectedUser();
  }

  /** Payload for the temporary contact, or null when an account was picked. */
  buildGuestPayload(): ITemporaryParticipant | null {
    const channel = this.guestChannel();
    if (!channel || this.selectedUser()) return null;

    const v = this.detailsForm.getRawValue();
    const data: ITemporaryParticipant = {};
    if (v.first_name) data.first_name = v.first_name;
    if (v.last_name) data.last_name = v.last_name;
    if (v.timezone) data.timezone = v.timezone;
    if (v.preferred_language) data.preferred_language = v.preferred_language;

    if (channel === 'email') {
      data.email = this.guestEmail();
      data.communication_method = 'email';
    } else if (channel === 'sms') {
      data.mobile_phone_number = this.guestPhone();
      data.communication_method =
        v.communication_method ||
        (this.communicationMethods[0]?.value as string) ||
        'sms';
    } else {
      data.communication_method = 'manual';
    }

    if (this.showVisibility) {
      data.is_consultation_visible = !!this.visibilityControl.value;
    }

    // A sent invitation needs somewhere to send it. A manual one needs
    // nothing: the backend creates a fresh temporary user and the access link
    // is handed over by the practitioner.
    if (channel === 'email' && !data.email) return null;
    if (channel === 'sms' && !data.mobile_phone_number) return null;
    return data;
  }

  /** Whether the selected contact may read the follow-up messages. */
  isConsultationVisible(): boolean {
    return !!this.visibilityControl.value;
  }

  reset(): void {
    this.clearSelection();
    this.visibilityControl.setValue(true, { emitEvent: false });
  }

  // --- Helpers -------------------------------------------------------------

  displayName(user: IUser): string {
    if (this.meUser && user.pk === this.meUser.pk) {
      return this.t.instant('userSearchSelect.me');
    }
    const name = `${user.first_name || ''} ${user.last_name || ''}`.trim();
    return name || user.email || user.username || '';
  }

  userMeta(user: IUser): string {
    return [user.email, user.mobile_phone_number].filter(Boolean).join(' · ');
  }

  initials(user: IUser): string {
    const first = user.first_name || '';
    const last = user.last_name || '';
    if (first && last) {
      return `${first.charAt(0)}${last.charAt(0)}`.toUpperCase();
    }
    return (first || last || user.email || 'U').charAt(0).toUpperCase();
  }

  /**
   * Deduce the invitation channel from what was typed: an e-mail address, a
   * mobile number, or a plain name (no channel).
   */
  /** Digits only, so "+33 6 12 34 56 78" and "+33612345678" compare equal. */
  private phoneDigits(value?: string): string {
    return (value || '').replace(/\D/g, '');
  }

  private detectChannel(value: string): ContactChannel | null {
    const trimmed = (value || '').trim();
    if (!trimmed) return null;
    if (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(trimmed)) return 'email';
    if (/^\+?[0-9][0-9\s().-]{5,}$/.test(trimmed)) return 'sms';
    return null;
  }

  private defaultCommunicationMethod(channel: ContactChannel): string {
    if (channel === 'email') return 'email';
    if (channel === 'manual') return 'manual';
    const methods = this.communicationMethods;
    return methods.length > 0 ? String(methods[0].value) : 'sms';
  }

  private defaultDetails(): Record<string, unknown> {
    const language = this.t.currentLanguage();
    return {
      first_name: '',
      last_name: '',
      preferred_language: (GUEST_LANGUAGES as readonly string[]).includes(
        language
      )
        ? language
        : 'en',
      timezone:
        this.meUser?.timezone ||
        Intl.DateTimeFormat().resolvedOptions().timeZone ||
        '',
      communication_method: '',
    };
  }

  private initDetailsForm(): void {
    this.detailsForm = this.fb.group(this.defaultDetails());
  }

  /** Rebuild the picker state from an already saved temporary contact. */
  private applyGuest(guest: ITemporaryParticipant): void {
    const channel: ContactChannel = guest.email
      ? 'email'
      : guest.mobile_phone_number
        ? 'sms'
        : 'manual';
    this.guestChannel.set(
      guest.communication_method === 'manual' ? 'manual' : channel
    );
    this.guestEmail.set(guest.email || '');
    this.guestPhone.set(guest.mobile_phone_number || '');
    this.detailsForm.patchValue(
      {
        first_name: guest.first_name || '',
        last_name: guest.last_name || '',
        preferred_language:
          guest.preferred_language ||
          this.detailsForm.get('preferred_language')?.value,
        timezone: guest.timezone || this.detailsForm.get('timezone')?.value,
        communication_method: guest.communication_method || '',
      },
      { emitEvent: false }
    );
    if (guest.is_consultation_visible !== undefined) {
      this.visibilityControl.setValue(guest.is_consultation_visible, {
        emitEvent: false,
      });
    }
  }

  private resetQuery(): void {
    this.query.set('');
    this.results.set([]);
    this.isOpen.set(false);
  }

  private emitSelection(): void {
    const user = this.selectedUser();
    if (user) {
      this.selectionChange.emit({ kind: 'user', user });
      return;
    }
    const channel = this.guestChannel();
    if (channel) {
      const guest = this.buildGuestPayload();
      this.selectionChange.emit(guest ? { kind: 'guest', channel, guest } : null);
      return;
    }
    this.selectionChange.emit(null);
  }

  private loadConfig(): void {
    this.authService
      .getOpenIDConfig()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: config => {
          this.availableCommunicationMethods.set(
            config?.communication_methods || []
          );
        },
      });
  }

  // --- ControlValueAccessor ------------------------------------------------

  writeValue(value: number | null): void {
    if (value == null) {
      // Hosts null the control when a temporary contact is used: keep it.
      if (this.selectedUser()) {
        this.selectedUser.set(null);
      }
      return;
    }
    if (this.selectedUser()?.pk === value) return;
    if (this._initialUser?.pk === value) {
      this.selectedUser.set(this._initialUser);
    }
  }

  registerOnChange(fn: (value: number | null) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }
}
