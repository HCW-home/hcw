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
import { forkJoin, Subject, takeUntil, debounceTime, distinctUntilChanged } from 'rxjs';

import { ConsultationService } from '../../../../core/services/consultation.service';
import { ConfirmationService } from '../../../../core/services/confirmation.service';
import { ToasterService } from '../../../../core/services/toaster.service';
import { ValidationService } from '../../../../core/services/validation.service';
import {
  AppointmentType,
  Consultation,
  CreateAppointmentRequest,
  CreateConsultationRequest,
  CreateParticipantRequest,
  Queue,
} from '../../../../core/models/consultation';

import { Page } from '../../../../core/components/page/page';
import { Loader } from '../../../../shared/components/loader/loader';
import { UserSearchSelect } from '../../../../shared/components/user-search-select/user-search-select';
import { Stepper } from '../../../../shared/components/stepper/stepper';
import { IStep } from '../../../../shared/components/stepper/stepper-models';

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
  formReady = signal(false);
  lastSaved = signal<Date | null>(null);
  savingAppointments = signal<Set<number>>(new Set());
  savingParticipants = signal<Set<string>>(new Set());
  participantContactTypes: Map<string, 'email' | 'phone'> = new Map();
  currentStep = signal(0);

  stepItems: IStep[] = [
    { id: 'details', title: 'Details' },
    { id: 'beneficiary', title: 'Beneficiary' },
    { id: 'schedule', title: 'Schedule', isOptional: true },
  ];

  consultationForm: FormGroup;

  protected readonly TypographyTypeEnum = TypographyTypeEnum;
  protected readonly ButtonSizeEnum = ButtonSizeEnum;
  protected readonly ButtonStyleEnum = ButtonStyleEnum;
  protected readonly ButtonStateEnum = ButtonStateEnum;

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

  communicationMethods: SelectOption[] = [
    { value: 'email', label: 'Email' },
    { value: 'sms', label: 'SMS' },
    { value: 'whatsapp', label: 'WhatsApp' },
  ];

  appointmentTypeOptions: SelectOption[] = [
    { value: AppointmentType.ONLINE, label: 'Online' },
    { value: AppointmentType.INPERSON, label: 'In Person' },
  ];

  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private fb = inject(FormBuilder);
  private consultationService = inject(ConsultationService);
  private confirmationService = inject(ConfirmationService);
  private toasterService = inject(ToasterService);
  private validationService = inject(ValidationService);

  constructor() {
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
      appointments: this.fb.array([]),
    });
  }

  ngOnInit(): void {
    this.loadQueues();

    this.initializeFormArray();

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

  private initializeFormArray(): void {
    this.formReady.set(true);
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  get appointmentsFormArray(): FormArray {
    return this.consultationForm.get('appointments') as FormArray;
  }

  loadQueues(): void {
    this.consultationService
      .getQueues()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: queues => {
          this.queues.set(queues);
        },
        error: () => {
          this.toasterService.show(
            'error',
            'Error loading teams - please check your connection'
          );
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
        },
        error: () => {
          this.isLoading.set(false);
          this.toasterService.show('error', 'Error loading consultation');
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

    if (this.mode === 'edit' && this.consultationId) {
      this.loadAppointments();
    }
  }

  loadAppointments(): void {
    if (!this.consultationId) return;

    this.consultationService
      .getConsultationAppointments(this.consultationId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: response => {
          while (this.appointmentsFormArray.length !== 0) {
            this.appointmentsFormArray.removeAt(0);
          }

          response.results.forEach(appointment => {
            const appointmentGroup = this.createAppointmentFormGroup();
            const scheduledDate = new Date(appointment.scheduled_at);
            const dateStr = scheduledDate.toISOString().split('T')[0];
            const timeStr = scheduledDate.toTimeString().slice(0, 5);

            appointmentGroup.patchValue({
              id: appointment.id,
              type: appointment.type || AppointmentType.ONLINE,
              date: dateStr,
              time: timeStr,
              scheduled_at: this.formatDateTimeForInput(
                appointment.scheduled_at
              ),
              end_expected_at: appointment.end_expected_at
                ? this.formatDateTimeForInput(appointment.end_expected_at)
                : '',
            });

            const participantsArray = appointmentGroup.get('participants') as FormArray;
            if (appointment.participants && appointment.participants.length > 0) {
              appointment.participants.forEach(participant => {
                const participantGroup = this.fb.group({
                  id: [participant.id],
                  name: [''],
                  email: [participant.email || '', [Validators.email]],
                  phone: [participant.phone || ''],
                  message_type: [participant.message_type || 'email', [Validators.required]],
                });
                participantsArray.push(participantGroup);
              });
            }

            this.appointmentsFormArray.push(appointmentGroup);
          });
        },
        error: () => {
          this.toasterService.show('error', 'Error loading appointments');
        },
      });
  }

  createAppointmentFormGroup(): FormGroup {
    return this.fb.group({
      id: [''],
      type: ['Online', [Validators.required]],
      date: [''],
      time: [''],
      scheduled_at: [''],
      end_expected_at: [''],
      participants: this.fb.array([]),
    });
  }

  addAppointment(): void {
    const appointmentGroup = this.createAppointmentFormGroup();
    this.appointmentsFormArray.push(appointmentGroup);
  }

  async removeAppointment(index: number): Promise<void> {
    const appointmentGroup = this.appointmentsFormArray.at(index) as FormGroup;
    const appointmentId = appointmentGroup.get('id')?.value;

    if (this.mode === 'edit' && appointmentId) {
      const confirmed = await this.confirmationService.confirm({
        title: 'Delete Appointment',
        message: 'Are you sure you want to delete this appointment? This action cannot be undone.',
        confirmText: 'Delete',
        cancelText: 'Cancel',
        confirmStyle: 'danger',
      });

      if (confirmed) {
        this.consultationService
          .deleteAppointment(appointmentId)
          .pipe(takeUntil(this.destroy$))
          .subscribe({
            next: () => {
              this.appointmentsFormArray.removeAt(index);
              this.toasterService.show('success', 'Appointment deleted successfully');
            },
            error: () => {
              this.toasterService.show('error', 'Error deleting appointment');
            },
          });
      }
    } else {
      this.appointmentsFormArray.removeAt(index);
    }
  }

  getParticipantsFormArray(appointmentIndex: number): FormArray {
    return this.appointmentsFormArray
      .at(appointmentIndex)
      .get('participants') as FormArray;
  }

  addParticipantToAppointment(appointmentIndex: number): void {
    const participantsArray = this.getParticipantsFormArray(appointmentIndex);
    this.addParticipantToFormArray(participantsArray);
  }

  private addParticipantToFormArray(participantsArray: FormArray): void {
    const participantGroup = this.fb.group({
      id: [''],
      name: [''],
      email: ['', [Validators.email]],
      phone: [''],
      message_type: ['email', [Validators.required]],
    });
    participantsArray.push(participantGroup);
  }

  async removeParticipantFromAppointment(
    appointmentIndex: number,
    participantIndex: number
  ): Promise<void> {
    const participantsArray = this.getParticipantsFormArray(appointmentIndex);
    const participantGroup = participantsArray.at(participantIndex) as FormGroup;
    const participantId = participantGroup.get('id')?.value;
    const appointmentGroup = this.appointmentsFormArray.at(appointmentIndex) as FormGroup;
    const appointmentId = appointmentGroup.get('id')?.value;

    if (this.mode === 'edit' && participantId && appointmentId) {
      const confirmed = await this.confirmationService.confirm({
        title: 'Remove Participant',
        message: 'Are you sure you want to remove this participant?',
        confirmText: 'Remove',
        cancelText: 'Cancel',
        confirmStyle: 'danger',
      });

      if (confirmed) {
        this.consultationService
          .removeAppointmentParticipant(appointmentId, participantId)
          .pipe(takeUntil(this.destroy$))
          .subscribe({
            next: () => {
              participantsArray.removeAt(participantIndex);
              this.toasterService.show('success', 'Participant removed successfully');
            },
            error: () => {
              this.toasterService.show('error', 'Error removing participant');
            },
          });
      }
    } else {
      participantsArray.removeAt(participantIndex);
    }
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
    if (!this.consultationId || !this.consultationForm.valid) return;

    const formValue = this.consultationForm.value;
    const consultationData: Partial<CreateConsultationRequest> = {
      title: formValue.title,
      description: formValue.description || undefined,
      group_id: formValue.group_id ? parseInt(formValue.group_id) : undefined,
      beneficiary: formValue.beneficiary_id ? parseInt(formValue.beneficiary_id) : undefined,
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
    if (this.consultationForm.valid) {
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
        'Please fill in all required fields correctly'
      );
    }
  }

  saveEditChanges(): void {
    if (!this.consultationId) return;

    if (!this.consultationForm.valid) {
      this.validationService.validateAllFormFields(this.consultationForm);
      this.toasterService.show('error', 'Please fill in all required fields correctly');
      return;
    }

    this.isSaving.set(true);

    const formValue = this.consultationForm.value;
    const newAppointments = formValue.appointments?.filter((apt: { id?: string; date?: string; scheduled_at?: string }) => !apt.id && (apt.date || apt.scheduled_at)) || [];

    if (newAppointments.length > 0) {
      this.createAppointmentsInEditMode(this.consultationId, newAppointments);
    } else {
      this.isSaving.set(false);
      this.toasterService.show('success', 'No new appointments to save');
    }
  }

  private createAppointmentsInEditMode(consultationId: number, appointments: { type?: string; date?: string; time?: string; scheduled_at?: string; end_expected_at?: string }[]): void {
    const appointmentRequests = appointments.map(apt => {
      let scheduledAt: string;
      if (apt.date && apt.time) {
        scheduledAt = new Date(`${apt.date}T${apt.time}`).toISOString();
      } else if (apt.date) {
        scheduledAt = new Date(`${apt.date}T09:00`).toISOString();
      } else {
        scheduledAt = new Date(apt.scheduled_at!).toISOString();
      }

      const appointmentData: CreateAppointmentRequest = {
        type: (apt.type as AppointmentType) || AppointmentType.ONLINE,
        scheduled_at: scheduledAt,
        end_expected_at: apt.end_expected_at
          ? new Date(apt.end_expected_at).toISOString()
          : undefined,
      };

      return this.consultationService.createConsultationAppointment(
        consultationId,
        appointmentData
      );
    });

    forkJoin(appointmentRequests)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: createdAppointments => {
          this.toasterService.show(
            'success',
            `${createdAppointments.length} appointment(s) created successfully`
          );
          this.isSaving.set(false);
          this.loadAppointments();
        },
        error: () => {
          this.isSaving.set(false);
          this.toasterService.show('error', 'Error creating some appointments');
        },
      });
  }

  createConsultation(): void {
    const formValue = this.consultationForm.value;
    const beneficiaryId = typeof formValue.beneficiary_id === 'number'
      ? formValue.beneficiary_id
      : (formValue.beneficiary_id ? parseInt(formValue.beneficiary_id) : undefined);
    const consultationData: CreateConsultationRequest = {
      title: formValue.title,
      description: formValue.description || undefined,
      group_id: formValue.group_id ? parseInt(formValue.group_id) : undefined,
      beneficiary: beneficiaryId,
    };

    this.consultationService
      .createConsultation(consultationData)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: consultation => {
          this.toasterService.show(
            'success',
            'Consultation created successfully'
          );

          if (formValue.appointments?.length > 0) {
            this.createAppointments(consultation.id, formValue.appointments);
          } else {
            this.isSaving.set(false);
            this.router.navigate([
              `/${RoutePaths.USER}/${RoutePaths.CONSULTATIONS}`,
              consultation.id,
            ]);
          }
        },
        error: () => {
          this.isSaving.set(false);
          this.toasterService.show('error', 'Error creating consultation');
        },
      });
  }

  updateConsultation(): void {
    if (!this.consultationId) return;

    const formValue = this.consultationForm.value;
    const consultationData: Partial<CreateConsultationRequest> = {
      title: formValue.title,
      description: formValue.description || undefined,
      group_id: parseInt(formValue.group_id),
      beneficiary: formValue.beneficiary_id
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
        error: () => {
          this.isSaving.set(false);
          this.toasterService.show('error', 'Error updating consultation');
        },
      });
  }

  createAppointments(consultationId: number, appointments: { type?: string; date?: string; time?: string; scheduled_at?: string; end_expected_at?: string }[]): void {
    const appointmentRequests = appointments
      .filter(apt => apt.date || apt.scheduled_at)
      .map(apt => {
        let scheduledAt: string;
        if (apt.date && apt.time) {
          scheduledAt = new Date(`${apt.date}T${apt.time}`).toISOString();
        } else if (apt.date) {
          scheduledAt = new Date(`${apt.date}T09:00`).toISOString();
        } else {
          scheduledAt = new Date(apt.scheduled_at!).toISOString();
        }

        const appointmentData: CreateAppointmentRequest = {
          type: (apt.type as AppointmentType) || AppointmentType.ONLINE,
          scheduled_at: scheduledAt,
          end_expected_at: apt.end_expected_at
            ? new Date(apt.end_expected_at).toISOString()
            : undefined,
        };

        return this.consultationService.createConsultationAppointment(
          consultationId,
          appointmentData
        );
      });

    if (appointmentRequests.length === 0) {
      this.isSaving.set(false);
      this.router.navigate([
        `/${RoutePaths.USER}/${RoutePaths.CONSULTATIONS}`,
        consultationId,
      ]);
      return;
    }

    forkJoin(appointmentRequests)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: createdAppointments => {
          this.toasterService.show(
            'success',
            `${createdAppointments.length} appointment(s) created successfully`
          );
          this.isSaving.set(false);
          this.router.navigate([
            `/${RoutePaths.USER}/${RoutePaths.CONSULTATIONS}`,
            consultationId,
          ]);
        },
        error: () => {
          this.isSaving.set(false);
          this.toasterService.show(
            'error',
            'Consultation created but failed to create some appointments'
          );
          this.router.navigate([
            `/${RoutePaths.USER}/${RoutePaths.CONSULTATIONS}`,
            consultationId,
          ]);
        },
      });
  }

  formatDateTimeForInput(dateString: string): string {
    const date = new Date(dateString);
    return date.toISOString().slice(0, 16);
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

  isAppointmentFieldInvalid(
    appointmentIndex: number,
    fieldName: string
  ): boolean {
    const appointmentGroup = this.appointmentsFormArray.at(appointmentIndex);
    const field = appointmentGroup?.get(fieldName);
    return (field?.invalid && field?.touched) || false;
  }

  isParticipantFieldInvalid(
    appointmentIndex: number,
    participantIndex: number,
    fieldName: string
  ): boolean {
    const participantsArray = this.getParticipantsFormArray(appointmentIndex);
    const participantGroup = participantsArray.at(participantIndex);
    const field = participantGroup?.get(fieldName);
    return (field?.invalid && field?.touched) || false;
  }

  saveAppointment(appointmentIndex: number): void {
    if (!this.consultationId) return;

    const appointmentGroup = this.appointmentsFormArray.at(appointmentIndex) as FormGroup;
    const appointmentId = appointmentGroup.get('id')?.value;
    const date = appointmentGroup.get('date')?.value;
    const time = appointmentGroup.get('time')?.value;
    const scheduledAt = appointmentGroup.get('scheduled_at')?.value;

    if (!date && !scheduledAt) {
      this.toasterService.show('error', 'Date is required');
      return;
    }

    const saving = new Set(this.savingAppointments());
    saving.add(appointmentIndex);
    this.savingAppointments.set(saving);

    let scheduledDateTime: string;
    if (date && time) {
      scheduledDateTime = new Date(`${date}T${time}`).toISOString();
    } else if (date) {
      scheduledDateTime = new Date(`${date}T09:00`).toISOString();
    } else {
      scheduledDateTime = new Date(scheduledAt).toISOString();
    }

    const appointmentData: CreateAppointmentRequest = {
      type: (appointmentGroup.get('type')?.value as AppointmentType) || AppointmentType.ONLINE,
      scheduled_at: scheduledDateTime,
      end_expected_at: appointmentGroup.get('end_expected_at')?.value
        ? new Date(appointmentGroup.get('end_expected_at')?.value).toISOString()
        : undefined,
    };

    if (appointmentId) {
      this.consultationService
        .updateAppointment(appointmentId, appointmentData)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: () => {
            const s = new Set(this.savingAppointments());
            s.delete(appointmentIndex);
            this.savingAppointments.set(s);
            this.toasterService.show('success', 'Appointment updated successfully');
          },
          error: () => {
            const s = new Set(this.savingAppointments());
            s.delete(appointmentIndex);
            this.savingAppointments.set(s);
            this.toasterService.show('error', 'Error updating appointment');
          },
        });
    } else {
      this.consultationService
        .createConsultationAppointment(this.consultationId, appointmentData)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: appointment => {
            appointmentGroup.patchValue({ id: appointment.id });
            const s = new Set(this.savingAppointments());
            s.delete(appointmentIndex);
            this.savingAppointments.set(s);
            this.toasterService.show('success', 'Appointment created successfully');
          },
          error: () => {
            const s = new Set(this.savingAppointments());
            s.delete(appointmentIndex);
            this.savingAppointments.set(s);
            this.toasterService.show('error', 'Error creating appointment');
          },
        });
    }
  }

  isAppointmentSaving(appointmentIndex: number): boolean {
    return this.savingAppointments().has(appointmentIndex);
  }

  saveParticipant(appointmentIndex: number, participantIndex: number): void {
    const appointmentGroup = this.appointmentsFormArray.at(appointmentIndex) as FormGroup;
    const appointmentId = appointmentGroup.get('id')?.value;

    if (!appointmentId) {
      this.toasterService.show('error', 'Please save the appointment first');
      return;
    }

    const participantsArray = this.getParticipantsFormArray(appointmentIndex);
    const participantGroup = participantsArray.at(participantIndex) as FormGroup;
    const participantId = participantGroup.get('id')?.value;
    const email = participantGroup.get('email')?.value;
    const phone = participantGroup.get('phone')?.value;

    if (!email && !phone) {
      this.toasterService.show('error', 'Email or phone is required');
      return;
    }

    const key = `${appointmentIndex}-${participantIndex}`;
    const saving = new Set(this.savingParticipants());
    saving.add(key);
    this.savingParticipants.set(saving);

    const participantData: CreateParticipantRequest = {
      email: email || undefined,
      phone: phone || undefined,
      message_type: participantGroup.get('message_type')?.value || 'email',
    };

    if (participantId) {
      this.consultationService
        .updateParticipant(participantId, participantData)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: () => {
            const s = new Set(this.savingParticipants());
            s.delete(key);
            this.savingParticipants.set(s);
            this.toasterService.show('success', 'Participant updated successfully');
          },
          error: () => {
            const s = new Set(this.savingParticipants());
            s.delete(key);
            this.savingParticipants.set(s);
            this.toasterService.show('error', 'Error updating participant');
          },
        });
    } else {
      this.consultationService
        .addAppointmentParticipant(appointmentId, participantData)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: participant => {
            participantGroup.patchValue({ id: participant.id });
            const s = new Set(this.savingParticipants());
            s.delete(key);
            this.savingParticipants.set(s);
            this.toasterService.show('success', 'Participant added successfully');
          },
          error: () => {
            const s = new Set(this.savingParticipants());
            s.delete(key);
            this.savingParticipants.set(s);
            this.toasterService.show('error', 'Error adding participant');
          },
        });
    }
  }

  isParticipantSaving(appointmentIndex: number, participantIndex: number): boolean {
    return this.savingParticipants().has(`${appointmentIndex}-${participantIndex}`);
  }

  hasAppointmentId(appointmentIndex: number): boolean {
    const appointmentGroup = this.appointmentsFormArray.at(appointmentIndex) as FormGroup;
    return !!appointmentGroup?.get('id')?.value;
  }

  hasParticipantId(appointmentIndex: number, participantIndex: number): boolean {
    const participantsArray = this.getParticipantsFormArray(appointmentIndex);
    const participantGroup = participantsArray.at(participantIndex) as FormGroup;
    return !!participantGroup?.get('id')?.value;
  }

  toggleParticipantsSection(appointmentIndex: number): void {
    const participantsArray = this.getParticipantsFormArray(appointmentIndex);
    if (participantsArray.length === 0) {
      this.addParticipantToAppointment(appointmentIndex);
    } else {
      while (participantsArray.length > 0) {
        participantsArray.removeAt(0);
      }
    }
  }

  getParticipantContactType(appointmentIndex: number, participantIndex: number): 'email' | 'phone' {
    const key = `${appointmentIndex}-${participantIndex}`;
    return this.participantContactTypes.get(key) || 'email';
  }

  setParticipantContactType(appointmentIndex: number, participantIndex: number, type: 'email' | 'phone'): void {
    const key = `${appointmentIndex}-${participantIndex}`;
    this.participantContactTypes.set(key, type);
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
        return titleControl ? titleControl.valid : false;
      case 1:
        return true;
      case 2:
        return true;
      default:
        return true;
    }
  }
}
