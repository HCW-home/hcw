import { Component, OnInit, OnDestroy, signal, computed } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { Subject, takeUntil } from 'rxjs';

import { ConsultationService } from '../../../../core/services/consultation.service';
import { ToasterService } from '../../../../core/services/toaster.service';
import { ValidationService } from '../../../../core/services/validation.service';
import { LoggerService } from '../../../../core/services/logger.service';
import {
  BookingSlot,
  CreateBookingSlot
} from '../../../../core/models/consultation';

import { Page } from '../../../../core/components/page/page';
import { Tabs, TabItem } from '../../../../shared/components/tabs/tabs';
import { Loader } from '../../../../shared/components/loader/loader';
import { ModalComponent } from '../../../../shared/components/modal/modal.component';
import { SlotModal } from '../slot-modal/slot-modal';

import { Typography } from '../../../../shared/ui-components/typography/typography';
import { Button } from '../../../../shared/ui-components/button/button';
import { Input as InputComponent } from '../../../../shared/ui-components/input/input';
import { Switch } from '../../../../shared/ui-components/switch/switch';
import { Svg } from '../../../../shared/ui-components/svg/svg';

import { TypographyTypeEnum } from '../../../../shared/constants/typography';
import { ButtonSizeEnum, ButtonStyleEnum } from '../../../../shared/constants/button';
import { RoutePaths } from '../../../../core/constants/routes';

interface WeekDay {
  key: keyof CreateBookingSlot;
  label: string;
  short: string;
}

@Component({
  selector: 'app-availability',
  templateUrl: './availability.html',
  styleUrl: './availability.scss',
  imports: [
    Svg,
    Page,
    Tabs,
    Loader,
    Button,
    Switch,
    SlotModal,
    Typography,
    CommonModule,
    InputComponent,
    ModalComponent,
    ReactiveFormsModule,
  ]
})
export class Availability implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  bookingSlots = signal<BookingSlot[]>([]);
  selectedSlot = signal<BookingSlot | null>(null);
  isLoading = signal(false);
  isSaving = signal(false);
  activeTab = signal<'schedule' | 'slots'>('schedule');
  showSlotModal = signal(false);
  modalMode = signal<'create' | 'edit'>('create');

  scheduleForm: FormGroup;
  slotForm: FormGroup;

  protected readonly TypographyTypeEnum = TypographyTypeEnum;
  protected readonly ButtonSizeEnum = ButtonSizeEnum;
  protected readonly ButtonStyleEnum = ButtonStyleEnum;
  protected readonly RoutePaths = RoutePaths;

  weekDays: WeekDay[] = [
    { key: 'monday', label: 'Monday', short: 'Mon' },
    { key: 'tuesday', label: 'Tuesday', short: 'Tue' },
    { key: 'wednesday', label: 'Wednesday', short: 'Wed' },
    { key: 'thursday', label: 'Thursday', short: 'Thu' },
    { key: 'friday', label: 'Friday', short: 'Fri' },
    { key: 'saturday', label: 'Saturday', short: 'Sat' },
    { key: 'sunday', label: 'Sunday', short: 'Sun' }
  ];

  tabItems = computed<TabItem[]>(() => [
    {
      id: 'schedule',
      label: 'Weekly Schedule',
      count: this.getActiveScheduleCount(),
    },
    {
      id: 'slots',
      label: 'Time Slots',
      count: this.bookingSlots().length,
    }
  ]);

  modalTitle = computed(() =>
    this.modalMode() === 'create' ? 'Create New Time Slot' : 'Edit Time Slot'
  );

  constructor(
    private fb: FormBuilder,
    private consultationService: ConsultationService,
    private toasterService: ToasterService,
    private validationService: ValidationService,
    private logger: LoggerService
  ) {
    this.scheduleForm = this.fb.group({
      start_time: ['08:00', [Validators.required]],
      end_time: ['17:00', [Validators.required]],
      start_break: ['12:00'],
      end_break: ['13:00'],

      monday: [true],
      tuesday: [true],
      wednesday: [true],
      thursday: [true],
      friday: [true],
      saturday: [false],
      sunday: [false],

      valid_until: ['']
    });

    this.slotForm = this.fb.group({
      start_time: ['', [Validators.required]],
      end_time: ['', [Validators.required]],
      start_break: [''],
      end_break: [''],
      monday: [false],
      tuesday: [false],
      wednesday: [false],
      thursday: [false],
      friday: [false],
      saturday: [false],
      sunday: [false],
      valid_until: ['']
    });
  }

  ngOnInit(): void {
    this.loadBookingSlots();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  setActiveTab(tab: string): void {
    this.activeTab.set(tab as 'schedule' | 'slots');
  }

  loadBookingSlots(): void {
    this.isLoading.set(true);
    this.consultationService.getBookingSlots()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          this.bookingSlots.set(response.results);
          this.isLoading.set(false);

          if (response.results.length > 0) {
            this.loadSlotIntoScheduleForm(response.results[0]);
          }
        },
        error: (error) => {
          this.logger.error('Error loading booking slots:', error);
          this.isLoading.set(false);
          this.toasterService.show('error', 'Error loading availability');
        }
      });
  }

  loadSlotIntoScheduleForm(slot: BookingSlot): void {
    this.scheduleForm.patchValue({
      start_time: this.formatTimeForInput(slot.start_time),
      end_time: this.formatTimeForInput(slot.end_time),
      start_break: slot.start_break ? this.formatTimeForInput(slot.start_break) : '',
      end_break: slot.end_break ? this.formatTimeForInput(slot.end_break) : '',
      monday: slot.monday,
      tuesday: slot.tuesday,
      wednesday: slot.wednesday,
      thursday: slot.thursday,
      friday: slot.friday,
      saturday: slot.saturday,
      sunday: slot.sunday,
      valid_until: slot.valid_until || ''
    });
    this.selectedSlot.set(slot);
  }

  saveSchedule(): void {
    if (this.scheduleForm.valid) {
      this.isSaving.set(true);
      const formValue = this.scheduleForm.value;

      const slotData: CreateBookingSlot = {
        start_time: formValue.start_time,
        end_time: formValue.end_time,
        start_break: formValue.start_break || null,
        end_break: formValue.end_break || null,
        monday: formValue.monday,
        tuesday: formValue.tuesday,
        wednesday: formValue.wednesday,
        thursday: formValue.thursday,
        friday: formValue.friday,
        saturday: formValue.saturday,
        sunday: formValue.sunday,
        valid_until: formValue.valid_until || null
      };

      const operation = this.selectedSlot()
        ? this.consultationService.updateBookingSlot(this.selectedSlot()!.id, slotData)
        : this.consultationService.createBookingSlot(slotData);

      operation.pipe(takeUntil(this.destroy$))
        .subscribe({
          next: () => {
            this.toasterService.show('success',
              this.selectedSlot() ? 'Schedule updated successfully' : 'Schedule created successfully'
            );
            this.isSaving.set(false);
            this.loadBookingSlots();
          },
          error: (error) => {
            this.logger.error('Error saving schedule:', error);
            this.isSaving.set(false);
            this.toasterService.show('error', 'Error saving schedule');
          }
        });
    } else {
      this.validationService.validateAllFormFields(this.scheduleForm);
      this.toasterService.show('error', 'Please fill in all required fields correctly');
    }
  }

  openSlotModal(mode: 'create' | 'edit', slot?: BookingSlot): void {
    this.modalMode.set(mode);
    this.showSlotModal.set(true);

    if (mode === 'edit' && slot) {
      this.selectedSlot.set(slot);
      this.slotForm.patchValue({
        start_time: this.formatTimeForInput(slot.start_time),
        end_time: this.formatTimeForInput(slot.end_time),
        start_break: slot.start_break ? this.formatTimeForInput(slot.start_break) : '',
        end_break: slot.end_break ? this.formatTimeForInput(slot.end_break) : '',
        monday: slot.monday,
        tuesday: slot.tuesday,
        wednesday: slot.wednesday,
        thursday: slot.thursday,
        friday: slot.friday,
        saturday: slot.saturday,
        sunday: slot.sunday,
        valid_until: slot.valid_until || ''
      });
    } else {
      this.selectedSlot.set(null);
      this.slotForm.reset({
        monday: false,
        tuesday: false,
        wednesday: false,
        thursday: false,
        friday: false,
        saturday: false,
        sunday: false
      });
    }
  }

  closeSlotModal(): void {
    this.showSlotModal.set(false);
    this.selectedSlot.set(null);
    this.slotForm.reset();
  }

  saveSlot(): void {
    if (this.slotForm.valid) {
      this.isSaving.set(true);
      const formValue = this.slotForm.value;

      const slotData: CreateBookingSlot = {
        start_time: formValue.start_time,
        end_time: formValue.end_time,
        start_break: formValue.start_break || null,
        end_break: formValue.end_break || null,
        monday: formValue.monday,
        tuesday: formValue.tuesday,
        wednesday: formValue.wednesday,
        thursday: formValue.thursday,
        friday: formValue.friday,
        saturday: formValue.saturday,
        sunday: formValue.sunday,
        valid_until: formValue.valid_until || null
      };

      const operation = this.modalMode() === 'edit' && this.selectedSlot()
        ? this.consultationService.updateBookingSlot(this.selectedSlot()!.id, slotData)
        : this.consultationService.createBookingSlot(slotData);

      operation.pipe(takeUntil(this.destroy$))
        .subscribe({
          next: () => {
            this.toasterService.show('success',
              this.modalMode() === 'edit' ? 'Time slot updated successfully' : 'Time slot created successfully'
            );
            this.isSaving.set(false);
            this.closeSlotModal();
            this.loadBookingSlots();
          },
          error: (error) => {
            this.logger.error('Error saving time slot:', error);
            this.isSaving.set(false);
            this.toasterService.show('error', 'Error saving time slot');
          }
        });
    } else {
      this.validationService.validateAllFormFields(this.slotForm);
      this.toasterService.show('error', 'Please fill in all required fields correctly');
    }
  }

  deleteSlot(slot: BookingSlot): void {
    if (confirm('Are you sure you want to delete this time slot?')) {
      this.consultationService.deleteBookingSlot(slot.id)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: () => {
            this.toasterService.show('success', 'Time slot deleted successfully');
            this.loadBookingSlots();
          },
          error: (error) => {
            this.logger.error('Error deleting time slot:', error);
            this.toasterService.show('error', 'Error deleting time slot');
          }
        });
    }
  }

  formatTimeForInput(timeString: string): string {
    return timeString.substring(0, 5);
  }

  formatTimeForDisplay(timeString: string): string {
    return this.formatTimeForInput(timeString);
  }

  getActiveScheduleCount(): number {
    const currentSlot = this.selectedSlot();
    if (!currentSlot) return 0;

    return [
      currentSlot.monday,
      currentSlot.tuesday,
      currentSlot.wednesday,
      currentSlot.thursday,
      currentSlot.friday,
      currentSlot.saturday,
      currentSlot.sunday
    ].filter(Boolean).length;
  }

  getActiveDaysForSlot(slot: BookingSlot): string[] {
    const activeDays = [];
    if (slot.monday) activeDays.push('Mon');
    if (slot.tuesday) activeDays.push('Tue');
    if (slot.wednesday) activeDays.push('Wed');
    if (slot.thursday) activeDays.push('Thu');
    if (slot.friday) activeDays.push('Fri');
    if (slot.saturday) activeDays.push('Sat');
    if (slot.sunday) activeDays.push('Sun');
    return activeDays;
  }

  getSlotTimeRange(slot: BookingSlot): string {
    const start = this.formatTimeForDisplay(slot.start_time);
    const end = this.formatTimeForDisplay(slot.end_time);
    return `${start} - ${end}`;
  }

  getBreakTimeRange(slot: BookingSlot): string {
    if (!slot.start_break || !slot.end_break) return 'No break';
    const start = this.formatTimeForDisplay(slot.start_break);
    const end = this.formatTimeForDisplay(slot.end_break);
    return `${start} - ${end}`;
  }

  isFieldInvalid(formGroup: FormGroup, fieldName: string): boolean {
    return this.validationService.showError(formGroup, fieldName);
  }

  getFieldError(formGroup: FormGroup, fieldName: string): string {
    const field = formGroup.get(fieldName);
    if (field?.errors && field?.touched) {
      if (field.errors['required']) return `${fieldName} is required`;
      if (field.errors['email']) return `Invalid email format`;
      if (field.errors['min']) return `${fieldName} is too short`;
      if (field.errors['max']) return `${fieldName} is too long`;
      if (field.errors['pattern']) return `${fieldName} format is invalid`;
    }
    return '';
  }
}
