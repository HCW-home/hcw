import {
  Component,
  computed,
  inject,
  OnDestroy,
  OnInit,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import {
  FormArray,
  FormBuilder,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Subject, takeUntil, debounceTime, distinctUntilChanged } from 'rxjs';

import { ConsultationService } from '../../../../core/services/consultation.service';
import { ToasterService } from '../../../../core/services/toaster.service';
import { ValidationService } from '../../../../core/services/validation.service';
import {
  Appointment,
  AppointmentType,
  AppointmentStatus,
  Consultation,
  CreateConsultationRequest,
  CreateAppointmentRequest,
  CreateParticipantRequest,
  Queue,
} from '../../../../core/models/consultation';

interface IAppointmentFormValue {
  id: number | null;
  date: string;
  time: string;
  type: AppointmentType;
  dont_invite_beneficiary: boolean;
  dont_invite_practitioner: boolean;
  dont_invite_me: boolean;
  participants: IParticipantFormValue[];
}

interface IParticipantFormValue {
  id: number | null;
  user_id: number | null;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  timezone: string;
  communication_method: string;
  preferred_language: string;
  is_existing_user: boolean;
  contact_type: 'email' | 'phone';
}

import { Page } from '../../../../core/components/page/page';
import { Loader } from '../../../../shared/components/loader/loader';
import { UserSearchSelect } from '../../../../shared/components/user-search-select/user-search-select';
import { IUser } from '../../models/user';
import { Stepper } from '../../../../shared/components/stepper/stepper';
import { IStep } from '../../../../shared/components/stepper/stepper-models';
import { Checkbox } from '../../../../shared/ui-components/checkbox/checkbox';

import { Typography } from '../../../../shared/ui-components/typography/typography';
import { Select } from '../../../../shared/ui-components/select/select';
import { Svg } from '../../../../shared/ui-components/svg/svg';
import { Input } from '../../../../shared/ui-components/input/input';
import { Textarea } from '../../../../shared/ui-components/textarea/textarea';
import { Button } from '../../../../shared/ui-components/button/button';

import { TypographyTypeEnum } from '../../../../shared/constants/typography';
import { ButtonStateEnum } from '../../../../shared/constants/button';
import {
  ButtonSizeEnum,
  ButtonStyleEnum,
} from '../../../../shared/constants/button';
import { SelectOption } from '../../../../shared/models/select';
import { IBreadcrumb } from '../../../../shared/models/breadcrumb';
import { RoutePaths } from '../../../../core/constants/routes';
import { getErrorMessage } from '../../../../core/utils/error-helper';

@Component({
  selector: 'app-consultation-form',
  templateUrl: './consultation-form.html',
  styleUrl: './consultation-form.scss',
  imports: [
    CommonModule,
    ReactiveFormsModule,
    Page,
    Loader,
    UserSearchSelect,
    Stepper,
    Typography,
    Select,
    Svg,
    Input,
    Textarea,
    Button,
    Checkbox,
  ],
})
export class ConsultationForm implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  mode: 'create' | 'edit' = 'create';
  consultationId?: number;

  consultation = signal<Consultation | null>(null);
  queues = signal<Queue[]>([]);
  isLoading = signal(false);
  isSaving = signal(false);
  isAutoSaving = signal(false);
  lastSaved = signal<Date | null>(null);
  currentStep = signal(0);
  formReady = signal(false);
  savingAppointments = signal<Set<number>>(new Set());

  stepItems: IStep[] = [
    { id: 'details', title: 'Details' },
    { id: 'owner', title: 'Assignment', isOptional: true },
    { id: 'schedule', title: 'Schedule', isOptional: true },
  ];

  selectedOwner = signal<IUser | null>(null);

  consultationForm!: FormGroup;

  appointmentTypeOptions: SelectOption[] = [
    { value: AppointmentType.ONLINE, label: 'Online' },
    { value: AppointmentType.INPERSON, label: 'In Person' },
  ];

  timezoneOptions: SelectOption[] = [
    { value: 'Europe/Paris', label: 'Europe/Paris (CET)' },
    { value: 'Europe/London', label: 'Europe/London (GMT)' },
    { value: 'America/New_York', label: 'America/New_York (EST)' },
    { value: 'America/Los_Angeles', label: 'America/Los_Angeles (PST)' },
    { value: 'Asia/Tokyo', label: 'Asia/Tokyo (JST)' },
  ];

  communicationMethods: SelectOption[] = [
    { value: 'email', label: 'Email' },
    { value: 'sms', label: 'SMS' },
    { value: 'whatsapp', label: 'WhatsApp' },
    { value: 'push', label: 'Push Notification' },
  ];

  languageOptions: SelectOption[] = [
    { value: 'en', label: 'English' },
    { value: 'fr', label: 'French' },
    { value: 'es', label: 'Spanish' },
    { value: 'de', label: 'German' },
  ];

  protected readonly TypographyTypeEnum = TypographyTypeEnum;
  protected readonly ButtonSizeEnum = ButtonSizeEnum;
  protected readonly ButtonStyleEnum = ButtonStyleEnum;
  protected readonly ButtonStateEnum = ButtonStateEnum;
  protected readonly AppointmentType = AppointmentType;

  breadcrumbs = computed<IBreadcrumb[]>(() => [
    { label: 'Consultations', link: '/user/consultations' },
    {
      label: this.mode === 'create' ? 'New Consultation' : 'Edit Consultation',
    },
  ]);

  queueOptions = computed<SelectOption[]>(() =>
    this.queues().map(queue => ({
      value: queue.id.toString(),
      label: queue.name,
    }))
  );

  pageTitle = computed(() =>
    this.mode === 'create' ? 'Create New Consultation' : 'Edit Consultation'
  );

  pageDescription = computed(() =>
    this.mode === 'create'
      ? 'Create a new consultation and schedule appointments with patients'
      : 'Update consultation details and manage appointments'
  );

  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private fb = inject(FormBuilder);
  private consultationService = inject(ConsultationService);
  private toasterService = inject(ToasterService);
  private validationService = inject(ValidationService);

  get appointmentsFormArray(): FormArray {
    return this.consultationForm.get('appointments') as FormArray;
  }

  constructor() {
    this.initForm();
  }

  private initForm(): void {
    this.consultationForm = this.fb.group({
      title: [
        '',
        [
          Validators.required,
          Validators.minLength(3),
          Validators.maxLength(200),
        ],
      ],
      description: ['', [Validators.maxLength(1000)]],
      group_id: [''],
      beneficiary_id: [''],
      owned_by_id: [''],
      appointments: this.fb.array([]),
    });
    this.formReady.set(true);
  }

  ngOnInit(): void {
    this.loadQueues();

    this.route.params.pipe(takeUntil(this.destroy$)).subscribe(params => {
      if (params['id']) {
        this.mode = 'edit';
        this.consultationId = +params['id'];
        this.loadConsultation();
      } else {
        this.mode = 'create';
      }
    });

    this.route.queryParams.pipe(takeUntil(this.destroy$)).subscribe(queryParams => {
      const step = queryParams['step'];
      if (step !== undefined) {
        const stepNum = parseInt(step, 10);
        if (!isNaN(stepNum) && stepNum >= 0 && stepNum <= 2) {
          this.currentStep.set(stepNum);
        }
      }
    });

    this.setupAutoSave();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadQueues(): void {
    this.consultationService
      .getQueues()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: queues => {
          this.queues.set(queues);
        },
        error: (error) => {
          this.toasterService.show('error', getErrorMessage(error));
          this.queues.set([]);
        },
      });
  }

  loadConsultation(): void {
    if (!this.consultationId) return;

    this.isLoading.set(true);
    this.consultationService
      .getConsultation(this.consultationId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: consultation => {
          this.consultation.set(consultation);
          this.populateForm(consultation);
          this.isLoading.set(false);
          this.loadAppointments();
        },
        error: (error) => {
          this.isLoading.set(false);
          this.toasterService.show('error', getErrorMessage(error));
          this.router.navigate([
            `/${RoutePaths.USER}/${RoutePaths.CONSULTATIONS}`,
          ]);
        },
      });
  }

  populateForm(consultation: Consultation): void {
    this.consultationForm.patchValue({
      title: consultation.title || '',
      description: consultation.description || '',
      group_id: consultation.group?.id?.toString() || '',
      beneficiary_id: consultation.beneficiary?.id?.toString() || '',
    });
  }

  loadAppointments(): void {
    if (!this.consultationId) return;

    this.consultationService
      .getConsultationAppointments(this.consultationId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: response => {
          this.appointmentsFormArray.clear();
          response.results.forEach((appointment: Appointment) => {
            this.addAppointmentFromData(appointment);
          });
        },
        error: (error) => {
          this.toasterService.show('error', getErrorMessage(error));
        },
      });
  }

  private addAppointmentFromData(appointment: Appointment): void {
    const scheduledDate = appointment.scheduled_at ? new Date(appointment.scheduled_at) : new Date();
    const date = scheduledDate.toISOString().split('T')[0];
    const time = scheduledDate.toTimeString().slice(0, 5);

    const appointmentGroup = this.fb.group({
      id: [appointment.id],
      date: [date, Validators.required],
      time: [time, Validators.required],
      type: [appointment.type || AppointmentType.ONLINE, Validators.required],
      dont_invite_beneficiary: [false],
      dont_invite_practitioner: [false],
      dont_invite_me: [false],
      participants: this.fb.array([]),
    });

    if (appointment.participants) {
      const participantsArray = appointmentGroup.get('participants') as FormArray;
      appointment.participants.forEach(p => {
        participantsArray.push(this.createParticipantGroup({
          id: p.id,
          user_id: p.user?.id,
          first_name: p.user?.first_name || '',
          last_name: p.user?.last_name || '',
          email: p.user?.email || '',
          phone: p.user?.mobile_phone_number || '',
          timezone: p.user?.timezone || 'Europe/Paris',
          communication_method: p.user?.communication_method || 'email',
          preferred_language: p.user?.preferred_language || 'en',
          is_existing_user: !!p.user,
          contact_type: p.user?.mobile_phone_number ? 'phone' : 'email',
        }));
      });
    }

    this.appointmentsFormArray.push(appointmentGroup);
  }

  private setupAutoSave(): void {
    this.consultationForm.valueChanges
      .pipe(
        debounceTime(800),
        distinctUntilChanged((prev, curr) => JSON.stringify(prev) === JSON.stringify(curr)),
        takeUntil(this.destroy$)
      )
      .subscribe(() => {
        if (this.mode === 'edit' && this.consultationId && !this.isAutoSaving()) {
          this.autoSaveConsultation();
        }
      });
  }

  private autoSaveConsultation(): void {
    if (!this.consultationId || !this.consultationForm.get('title')?.valid) return;

    const formValue = this.consultationForm.value;
    const consultationData: Partial<CreateConsultationRequest> = {
      title: formValue.title,
      description: formValue.description || undefined,
      group_id: formValue.group_id ? parseInt(formValue.group_id) : undefined,
      beneficiary_id: formValue.beneficiary_id ? parseInt(formValue.beneficiary_id) : undefined,
    };

    this.isAutoSaving.set(true);

    this.consultationService
      .updateConsultation(this.consultationId, consultationData)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: consultation => {
          this.consultation.set(consultation);
          this.lastSaved.set(new Date());
          this.isAutoSaving.set(false);
        },
        error: () => {
          this.isAutoSaving.set(false);
        },
      });
  }

  onSubmit(): void {
    const titleControl = this.consultationForm.get('title');
    if (titleControl?.valid) {
      this.isSaving.set(true);

      if (this.mode === 'create') {
        this.createConsultation();
      } else {
        this.updateConsultation();
      }
    } else {
      this.validationService.validateAllFormFields(this.consultationForm);
      this.toasterService.show(
        'error',
        'Please fill in the reason field'
      );
    }
  }

  createConsultation(): void {
    const formValue = this.consultationForm.value;
    const beneficiaryId = typeof formValue.beneficiary_id === 'number'
      ? formValue.beneficiary_id
      : (formValue.beneficiary_id ? parseInt(formValue.beneficiary_id) : undefined);
    const ownedById = typeof formValue.owned_by_id === 'number'
      ? formValue.owned_by_id
      : (formValue.owned_by_id ? parseInt(formValue.owned_by_id) : undefined);
    const consultationData: CreateConsultationRequest = {
      title: formValue.title,
      description: formValue.description || undefined,
      group_id: formValue.group_id ? parseInt(formValue.group_id) : undefined,
      beneficiary_id: beneficiaryId,
      owned_by_id: ownedById,
    };

    this.consultationService
      .createConsultation(consultationData)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: consultation => {
          if (this.appointmentsFormArray.length > 0) {
            this.createAppointmentsForConsultation(consultation.id);
          } else {
            this.toasterService.show(
              'success',
              'Consultation created successfully'
            );
            this.isSaving.set(false);
            this.router.navigate([
              `/${RoutePaths.USER}/${RoutePaths.CONSULTATIONS}`,
              consultation.id,
            ]);
          }
        },
        error: (error) => {
          this.isSaving.set(false);
          this.toasterService.show('error', getErrorMessage(error));
        },
      });
  }

  private createAppointmentsForConsultation(consultationId: number): void {
    const appointments = this.appointmentsFormArray.value as IAppointmentFormValue[];
    let completed = 0;

    appointments.forEach((apt: IAppointmentFormValue) => {
      const scheduledAt = this.combineDateTime(apt.date, apt.time);
      const participants = this.mapParticipantsForRequest(apt.participants);

      const appointmentData: CreateAppointmentRequest = {
        scheduled_at: scheduledAt,
        type: apt.type,
        dont_invite_beneficiary: apt.dont_invite_beneficiary,
        dont_invite_practitioner: apt.dont_invite_practitioner,
        dont_invite_me: apt.dont_invite_me,
        participants: participants,
      };

      this.consultationService
        .createConsultationAppointment(consultationId, appointmentData)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: () => {
            completed++;
            if (completed === appointments.length) {
              this.toasterService.show(
                'success',
                'Consultation created successfully'
              );
              this.isSaving.set(false);
              this.router.navigate([
                `/${RoutePaths.USER}/${RoutePaths.CONSULTATIONS}`,
                consultationId,
              ]);
            }
          },
          error: (error: HttpErrorResponse) => {
            this.toasterService.show('error', getErrorMessage(error));
            completed++;
            if (completed === appointments.length) {
              this.isSaving.set(false);
              this.router.navigate([
                `/${RoutePaths.USER}/${RoutePaths.CONSULTATIONS}`,
                consultationId,
              ]);
            }
          },
        });
    });
  }

  updateConsultation(): void {
    if (!this.consultationId) return;

    const formValue = this.consultationForm.value;
    const consultationData: Partial<CreateConsultationRequest> = {
      title: formValue.title,
      description: formValue.description || undefined,
      group_id: formValue.group_id ? parseInt(formValue.group_id) : undefined,
      beneficiary_id: formValue.beneficiary_id
        ? parseInt(formValue.beneficiary_id)
        : undefined,
    };

    this.consultationService
      .updateConsultation(this.consultationId, consultationData)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: consultation => {
          this.consultation.set(consultation);
          this.toasterService.show(
            'success',
            'Consultation updated successfully'
          );
          this.isSaving.set(false);
          this.router.navigate([
            `/${RoutePaths.USER}/${RoutePaths.CONSULTATIONS}`,
            consultation.id,
          ]);
        },
        error: (error) => {
          this.isSaving.set(false);
          this.toasterService.show('error', getErrorMessage(error));
        },
      });
  }

  cancel(): void {
    if (this.mode === 'edit' && this.consultationId) {
      this.router.navigate([
        `/${RoutePaths.USER}/${RoutePaths.CONSULTATIONS}`,
        this.consultationId,
      ]);
    } else {
      this.router.navigate([`/${RoutePaths.USER}/${RoutePaths.CONSULTATIONS}`]);
    }
  }

  isFieldInvalid(fieldName: string): boolean {
    const field = this.consultationForm.get(fieldName);
    return (field?.invalid && field?.touched) || false;
  }

  getFieldError(fieldName: string): string {
    const field = this.consultationForm.get(fieldName);
    if (field?.errors && field?.touched) {
      if (field.errors['required']) return `${fieldName} is required`;
      if (field.errors['minlength']) return `${fieldName} is too short`;
      if (field.errors['maxlength']) return `${fieldName} is too long`;
      if (field.errors['email']) return `Invalid email format`;
    }
    return '';
  }

  onOwnerSelected(user: IUser | null): void {
    this.selectedOwner.set(user);
    if (user) {
      this.consultationForm.patchValue({ owned_by_id: user.pk });
    } else {
      this.consultationForm.patchValue({ owned_by_id: '' });
    }
  }

  nextStep(): void {
    if (this.canProceedToNextStep() && this.currentStep() < 2) {
      const newStep = this.currentStep() + 1;
      this.currentStep.set(newStep);
      this.updateStepInUrl(newStep);
    }
  }

  previousStep(): void {
    if (this.currentStep() > 0) {
      const newStep = this.currentStep() - 1;
      this.currentStep.set(newStep);
      this.updateStepInUrl(newStep);
    }
  }

  goToStep(step: number): void {
    if (step >= 0 && step <= 2) {
      this.currentStep.set(step);
      this.updateStepInUrl(step);
    }
  }

  private updateStepInUrl(step: number): void {
    this.router.navigate([], {
      queryParams: { step },
      queryParamsHandling: 'merge',
      replaceUrl: true
    });
  }

  canProceedToNextStep(): boolean {
    return this.isStepValid(this.currentStep());
  }

  isStepValid(step: number): boolean {
    switch (step) {
      case 0:
        const titleControl = this.consultationForm.get('title');
        return titleControl?.valid ?? false;
      case 1:
        return true;
      case 2:
        return true;
      default:
        return true;
    }
  }

  addAppointment(): void {
    const appointmentGroup = this.fb.group({
      id: [null],
      date: ['', Validators.required],
      time: ['', Validators.required],
      type: [AppointmentType.ONLINE, Validators.required],
      dont_invite_beneficiary: [false],
      dont_invite_practitioner: [false],
      dont_invite_me: [false],
      participants: this.fb.array([]),
    });
    this.appointmentsFormArray.push(appointmentGroup);
  }

  removeAppointment(index: number): void {
    const appointment = this.appointmentsFormArray.at(index);
    const appointmentId = appointment.get('id')?.value;

    if (appointmentId && this.mode === 'edit') {
      this.consultationService
        .deleteAppointment(appointmentId)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: () => {
            this.appointmentsFormArray.removeAt(index);
            this.toasterService.show('success', 'Appointment removed');
          },
          error: (error) => {
            this.toasterService.show('error', getErrorMessage(error));
          },
        });
    } else {
      this.appointmentsFormArray.removeAt(index);
    }
  }

  saveAppointment(index: number): void {
    if (!this.consultationId) return;

    const appointment = this.appointmentsFormArray.at(index);
    const appointmentId = appointment.get('id')?.value;
    const formValue = appointment.value as IAppointmentFormValue;

    const scheduledAt = this.combineDateTime(formValue.date, formValue.time);
    const participants = this.mapParticipantsForRequest(formValue.participants);

    const saving = new Set(this.savingAppointments());
    saving.add(index);
    this.savingAppointments.set(saving);

    if (appointmentId) {
      this.consultationService
        .updateAppointment(appointmentId, {
          scheduled_at: scheduledAt,
          type: formValue.type,
          participants: participants,
        })
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: () => {
            const s = new Set(this.savingAppointments());
            s.delete(index);
            this.savingAppointments.set(s);
            this.toasterService.show('success', 'Appointment updated');
          },
          error: (error) => {
            const s = new Set(this.savingAppointments());
            s.delete(index);
            this.savingAppointments.set(s);
            this.toasterService.show('error', getErrorMessage(error));
          },
        });
    } else {
      const appointmentData: CreateAppointmentRequest = {
        scheduled_at: scheduledAt,
        type: formValue.type,
        dont_invite_beneficiary: formValue.dont_invite_beneficiary,
        dont_invite_practitioner: formValue.dont_invite_practitioner,
        dont_invite_me: formValue.dont_invite_me,
        participants: participants,
      };

      this.consultationService
        .createConsultationAppointment(this.consultationId, appointmentData)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: (created: Appointment) => {
            appointment.patchValue({ id: created.id });
            const s = new Set(this.savingAppointments());
            s.delete(index);
            this.savingAppointments.set(s);
            this.toasterService.show('success', 'Appointment created');
          },
          error: (error: HttpErrorResponse) => {
            const s = new Set(this.savingAppointments());
            s.delete(index);
            this.savingAppointments.set(s);
            this.toasterService.show('error', getErrorMessage(error));
          },
        });
    }
  }

  isAppointmentSaving(index: number): boolean {
    return this.savingAppointments().has(index);
  }

  hasAppointmentId(index: number): boolean {
    const appointment = this.appointmentsFormArray.at(index);
    return !!appointment?.get('id')?.value;
  }

  isAppointmentFieldInvalid(appointmentIndex: number, fieldName: string): boolean {
    const appointment = this.appointmentsFormArray.at(appointmentIndex);
    const field = appointment?.get(fieldName);
    return (field?.invalid && field?.touched) || false;
  }

  getParticipantsFormArray(appointmentIndex: number): FormArray {
    const appointment = this.appointmentsFormArray.at(appointmentIndex);
    return appointment.get('participants') as FormArray;
  }

  addParticipantToAppointment(appointmentIndex: number): void {
    const participantsArray = this.getParticipantsFormArray(appointmentIndex);
    participantsArray.push(this.createParticipantGroup());
  }

  removeParticipantFromAppointment(appointmentIndex: number, participantIndex: number): void {
    const participantsArray = this.getParticipantsFormArray(appointmentIndex);
    participantsArray.removeAt(participantIndex);
  }

  private createParticipantGroup(data?: Record<string, unknown>): FormGroup {
    return this.fb.group({
      id: [data?.['id'] || null],
      user_id: [data?.['user_id'] || null],
      first_name: [data?.['first_name'] || ''],
      last_name: [data?.['last_name'] || ''],
      email: [data?.['email'] || ''],
      phone: [data?.['phone'] || ''],
      timezone: [data?.['timezone'] || 'Europe/Paris'],
      communication_method: [data?.['communication_method'] || 'email'],
      preferred_language: [data?.['preferred_language'] || 'en'],
      is_existing_user: [data?.['is_existing_user'] !== undefined ? data['is_existing_user'] : true],
      contact_type: [data?.['contact_type'] || 'email'],
    });
  }

  isParticipantExistingUser(appointmentIndex: number, participantIndex: number): boolean {
    const participant = this.getParticipantsFormArray(appointmentIndex).at(participantIndex);
    return participant?.get('is_existing_user')?.value || false;
  }

  setParticipantType(appointmentIndex: number, participantIndex: number, isExistingUser: boolean): void {
    const participant = this.getParticipantsFormArray(appointmentIndex).at(participantIndex);
    participant.patchValue({ is_existing_user: isExistingUser });
    if (isExistingUser) {
      participant.patchValue({
        first_name: '',
        last_name: '',
        email: '',
        phone: '',
      });
    } else {
      participant.patchValue({ user_id: null });
    }
  }

  getParticipantContactType(appointmentIndex: number, participantIndex: number): string {
    const participant = this.getParticipantsFormArray(appointmentIndex).at(participantIndex);
    return participant?.get('contact_type')?.value || 'email';
  }

  setParticipantContactType(appointmentIndex: number, participantIndex: number, contactType: string): void {
    const participant = this.getParticipantsFormArray(appointmentIndex).at(participantIndex);
    participant.patchValue({ contact_type: contactType, email: '', phone: '' });
  }

  onParticipantUserSelected(appointmentIndex: number, participantIndex: number, user: IUser | null): void {
    const participant = this.getParticipantsFormArray(appointmentIndex).at(participantIndex);
    if (user) {
      participant.patchValue({
        user_id: user.pk,
        first_name: user.first_name,
        last_name: user.last_name,
        email: user.email,
      });
    } else {
      participant.patchValue({
        user_id: null,
        first_name: '',
        last_name: '',
        email: '',
      });
    }
  }

  setAppointmentType(appointmentIndex: number, type: AppointmentType): void {
    const appointment = this.appointmentsFormArray.at(appointmentIndex);
    appointment.patchValue({ type });
  }

  getAppointmentType(appointmentIndex: number): AppointmentType {
    const appointment = this.appointmentsFormArray.at(appointmentIndex);
    return appointment?.get('type')?.value || AppointmentType.ONLINE;
  }

  private mapParticipantsForRequest(participants: IParticipantFormValue[]): CreateParticipantRequest[] {
    if (!participants || participants.length === 0) {
      return [];
    }

    return participants.map((p: IParticipantFormValue) => {
      const request: CreateParticipantRequest = {
        message_type: p.contact_type === 'phone' ? 'sms' : 'email',
        timezone: p.timezone || '',
        communication_method: p.communication_method,
        preferred_language: p.preferred_language,
      };

      if (p.id) {
        request.id = p.id;
      }

      if (p.is_existing_user && p.user_id) {
        request.user_id = p.user_id;
      } else {
        if (p.first_name) {
          request.first_name = p.first_name;
        }

        if (p.last_name) {
          request.last_name = p.last_name;
        }

        if (p.contact_type === 'email' && p.email) {
          request.email = p.email;
        } else if (p.contact_type === 'phone' && p.phone) {
          request.mobile_phone_number = p.phone;
        }
      }

      return request;
    });
  }

  private combineDateTime(date: string, time: string): string {
    return `${date}T${time}:00`;
  }
}
