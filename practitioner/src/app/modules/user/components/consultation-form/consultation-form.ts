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
import { ToasterService } from '../../../../core/services/toaster.service';
import { ValidationService } from '../../../../core/services/validation.service';
import {
  AppointmentType,
  Consultation,
  CreateAppointmentRequest,
  CreateConsultationRequest,
  Queue,
} from '../../../../core/models/consultation';

import { Page } from '../../../../core/components/page/page';
import { Loader } from '../../../../shared/components/loader/loader';

import { Typography } from '../../../../shared/ui-components/typography/typography';
import { Button } from '../../../../shared/ui-components/button/button';
import { Input as InputComponent } from '../../../../shared/ui-components/input/input';
import { Textarea } from '../../../../shared/ui-components/textarea/textarea';
import { Select } from '../../../../shared/ui-components/select/select';
import { Svg } from '../../../../shared/ui-components/svg/svg';

import { TypographyTypeEnum } from '../../../../shared/constants/typography';
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
    Typography,
    Button,
    InputComponent,
    Textarea,
    Select,
    Svg,
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

  consultationForm: FormGroup;

  protected readonly TypographyTypeEnum = TypographyTypeEnum;
  protected readonly ButtonSizeEnum = ButtonSizeEnum;
  protected readonly ButtonStyleEnum = ButtonStyleEnum;

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

    this.setupAutoSave();
  }

  private initializeFormArray(): void {
    const appointmentGroup = this.createAppointmentFormGroup();
    const participantsArray = appointmentGroup.get('participants') as FormArray;
    this.addParticipantToFormArray(participantsArray);
    this.appointmentsFormArray.push(appointmentGroup);
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
        error: error => {
          console.error('Error loading queues:', error);
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
        error: error => {
          console.error('Error loading consultation:', error);
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
            appointmentGroup.patchValue({
              id: appointment.id,
              type: appointment.type || AppointmentType.ONLINE,
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
                  email: [participant.email || '', [Validators.email]],
                  phone: [participant.phone || ''],
                  message_type: [participant.message_type || 'email', [Validators.required]],
                });
                participantsArray.push(participantGroup);
              });
            } else {
              this.addParticipantToFormArray(participantsArray);
            }

            this.appointmentsFormArray.push(appointmentGroup);
          });

          if (this.appointmentsFormArray.length === 0) {
            this.addAppointment();
          }
        },
        error: error => {
          console.error('Error loading appointments:', error);
          this.toasterService.show('error', 'Error loading appointments');
        },
      });
  }

  createAppointmentFormGroup(): FormGroup {
    return this.fb.group({
      id: [''],
      type: ['Online', [Validators.required]],
      scheduled_at: ['', [Validators.required]],
      end_expected_at: [''],
      participants: this.fb.array([]),
    });
  }

  addAppointment(): void {
    const appointmentGroup = this.createAppointmentFormGroup();
    this.appointmentsFormArray.push(appointmentGroup);
    const newIndex = this.appointmentsFormArray.length - 1;
    this.addParticipantToAppointment(newIndex);
  }

  removeAppointment(index: number): void {
    const appointmentGroup = this.appointmentsFormArray.at(index) as FormGroup;
    const appointmentId = appointmentGroup.get('id')?.value;

    if (this.mode === 'edit' && appointmentId) {
      if (confirm('Are you sure you want to delete this appointment? This action cannot be undone.')) {
        this.consultationService
          .deleteAppointment(appointmentId)
          .pipe(takeUntil(this.destroy$))
          .subscribe({
            next: () => {
              this.appointmentsFormArray.removeAt(index);
              this.toasterService.show('success', 'Appointment deleted successfully');
            },
            error: error => {
              console.error('Error deleting appointment:', error);
              this.toasterService.show('error', 'Error deleting appointment');
            },
          });
      }
    } else {
      this.appointmentsFormArray.removeAt(index);
      if (this.appointmentsFormArray.length === 0) {
        this.addAppointment();
      }
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
      email: ['', [Validators.email]],
      phone: [''],
      message_type: ['email', [Validators.required]],
    });
    participantsArray.push(participantGroup);
  }

  removeParticipantFromAppointment(
    appointmentIndex: number,
    participantIndex: number
  ): void {
    const participantsArray = this.getParticipantsFormArray(appointmentIndex);
    const participantGroup = participantsArray.at(participantIndex) as FormGroup;
    const participantId = participantGroup.get('id')?.value;
    const appointmentGroup = this.appointmentsFormArray.at(appointmentIndex) as FormGroup;
    const appointmentId = appointmentGroup.get('id')?.value;

    if (this.mode === 'edit' && participantId && appointmentId) {
      if (confirm('Are you sure you want to remove this participant?')) {
        this.consultationService
          .removeAppointmentParticipant(appointmentId, participantId)
          .pipe(takeUntil(this.destroy$))
          .subscribe({
            next: () => {
              participantsArray.removeAt(participantIndex);
              this.toasterService.show('success', 'Participant removed successfully');
              if (participantsArray.length === 0) {
                this.addParticipantToFormArray(participantsArray);
              }
            },
            error: error => {
              console.error('Error removing participant:', error);
              this.toasterService.show('error', 'Error removing participant');
            },
          });
      }
    } else {
      participantsArray.removeAt(participantIndex);
      if (participantsArray.length === 0) {
        this.addParticipantToFormArray(participantsArray);
      }
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
        error: error => {
          console.error('Error auto-saving consultation:', error);
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
    const newAppointments = formValue.appointments?.filter((apt: any) => !apt.id && apt.scheduled_at) || [];

    if (newAppointments.length > 0) {
      this.createAppointmentsInEditMode(this.consultationId, newAppointments);
    } else {
      this.isSaving.set(false);
      this.toasterService.show('success', 'No new appointments to save');
    }
  }

  private createAppointmentsInEditMode(consultationId: number, appointments: any[]): void {
    const appointmentRequests = appointments.map(apt => {
      const appointmentData: CreateAppointmentRequest = {
        type: apt.type || AppointmentType.ONLINE,
        scheduled_at: new Date(apt.scheduled_at).toISOString(),
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
        error: error => {
          console.error('Error creating appointments:', error);
          this.isSaving.set(false);
          this.toasterService.show('error', 'Error creating some appointments');
        },
      });
  }

  createConsultation(): void {
    const formValue = this.consultationForm.value;
    const consultationData: CreateConsultationRequest = {
      title: formValue.title,
      description: formValue.description || undefined,
      group_id: parseInt(formValue.group_id),
      beneficiary_id: formValue.beneficiary_id
        ? parseInt(formValue.beneficiary_id)
        : undefined,
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
        error: error => {
          console.error('Error creating consultation:', error);
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
        error: error => {
          console.error('Error updating consultation:', error);
          this.isSaving.set(false);
          this.toasterService.show('error', 'Error updating consultation');
        },
      });
  }

  createAppointments(consultationId: number, appointments: any[]): void {
    const appointmentRequests = appointments
      .filter(apt => apt.scheduled_at)
      .map(apt => {
        const appointmentData: CreateAppointmentRequest = {
          type: apt.type || AppointmentType.ONLINE,
          scheduled_at: new Date(apt.scheduled_at).toISOString(),
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
        error: error => {
          console.error('Error creating appointments:', error);
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

  formatDateTime(dateString: string): string {
    return new Date(dateString).toLocaleString();
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
}
