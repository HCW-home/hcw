import { Component, OnInit, OnDestroy, signal, computed, ViewChild, ElementRef, inject, DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { Subject, takeUntil } from 'rxjs';
import { Router, ActivatedRoute } from '@angular/router';

import { Page } from '../../../../core/components/page/page';
import { Tabs, TabItem } from '../../../../shared/components/tabs/tabs';
import { Loader } from '../../../../shared/components/loader/loader';
import { ModalComponent } from '../../../../shared/components/modal/modal.component';
import { SlotModal } from '../slot-modal/slot-modal';

import { Button } from '../../../../shared/ui-components/button/button';
import { Svg } from '../../../../shared/ui-components/svg/svg';

import { ButtonSizeEnum, ButtonStyleEnum, ButtonStateEnum } from '../../../../shared/constants/button';

import { ConsultationService } from '../../../../core/services/consultation.service';
import { ToasterService } from '../../../../core/services/toaster.service';
import { ValidationService } from '../../../../core/services/validation.service';
import { LoggerService } from '../../../../core/services/logger.service';
import { LiveKitService, ConnectionStatus } from '../../../../core/services/livekit.service';
import { UserService } from '../../../../core/services/user.service';
import { ConfirmationService } from '../../../../core/services/confirmation.service';

import { BookingSlot, CreateBookingSlot } from '../../../../core/models/consultation';
import { LocalVideoTrack, LocalAudioTrack } from 'livekit-client';
import { getErrorMessage } from '../../../../core/utils/error-helper';
import { TranslatePipe } from '@ngx-translate/core';
import { TranslationService } from '../../../../core/services/translation.service';

type TestStatus = 'idle' | 'testing' | 'working' | 'error' | 'playing';

interface WeekDay {
  key: keyof CreateBookingSlot;
  label: string;
  short: string;
}

@Component({
  selector: 'app-configuration',
  imports: [
    CommonModule,
    Page,
    Tabs,
    Loader,
    ModalComponent,
    SlotModal,
    Button,
    Svg,
    TranslatePipe,
  ],
  templateUrl: './configuration.html',
  styleUrl: './configuration.scss',
})
export class Configuration implements OnInit, OnDestroy {
  @ViewChild('videoElement') videoElement?: ElementRef<HTMLVideoElement>;

  private destroy$ = new Subject<void>();
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private fb = inject(FormBuilder);
  private consultationService = inject(ConsultationService);
  private toasterService = inject(ToasterService);
  private validationService = inject(ValidationService);
  private logger = inject(LoggerService);
  private livekitService = inject(LiveKitService);
  private userService = inject(UserService);
  private confirmationService = inject(ConfirmationService);
  private destroyRef = inject(DestroyRef);
  private t = inject(TranslationService);

  activeTab = signal<'system-test' | 'availability'>('system-test');

  connectionStatus = signal<ConnectionStatus>('disconnected');
  cameraStatus = signal<TestStatus>('idle');
  microphoneStatus = signal<TestStatus>('idle');
  speakerStatus = signal<TestStatus>('idle');

  private localVideoTrack: LocalVideoTrack | null = null;
  private localAudioTrack: LocalAudioTrack | null = null;
  private audioContext: AudioContext | null = null;
  private analyserNode: AnalyserNode | null = null;
  private animationFrame: number | null = null;
  private testAudio: HTMLAudioElement | null = null;
  private isConnecting = false;

  volumeBars = signal<number[]>(Array(20).fill(0));

  bookingSlots = signal<BookingSlot[]>([]);
  selectedSlot = signal<BookingSlot | null>(null);
  isLoading = signal(false);
  isSaving = signal(false);
  showSlotModal = signal(false);
  modalMode = signal<'create' | 'edit'>('create');

  slotForm: FormGroup;

  weekDays: WeekDay[] = [
    { key: 'monday', label: 'configuration.dayMonday', short: 'configuration.dayMon' },
    { key: 'tuesday', label: 'configuration.dayTuesday', short: 'configuration.dayTue' },
    { key: 'wednesday', label: 'configuration.dayWednesday', short: 'configuration.dayWed' },
    { key: 'thursday', label: 'configuration.dayThursday', short: 'configuration.dayThu' },
    { key: 'friday', label: 'configuration.dayFriday', short: 'configuration.dayFri' },
    { key: 'saturday', label: 'configuration.daySaturday', short: 'configuration.daySat' },
    { key: 'sunday', label: 'configuration.daySunday', short: 'configuration.daySun' }
  ];

  tabItems = computed<TabItem[]>(() => [
    { id: 'system-test', label: this.t.instant('configuration.tabSystemTest') },
    { id: 'availability', label: this.t.instant('configuration.tabAvailability'), count: this.bookingSlots().length }
  ]);

  modalTitle = computed(() =>
    this.modalMode() === 'create' ? this.t.instant('configuration.createNewSlot') : this.t.instant('configuration.editTimeSlot')
  );

  protected readonly ButtonSizeEnum = ButtonSizeEnum;
  protected readonly ButtonStyleEnum = ButtonStyleEnum;
  protected readonly ButtonStateEnum = ButtonStateEnum;

  constructor() {
    this.slotForm = this.fb.group({
      start_time: ['09:00', [Validators.required]],
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
  }

  ngOnInit(): void {
    this.route.fragment.pipe(takeUntil(this.destroy$)).subscribe(fragment => {
      if (fragment === 'availability' || fragment === 'system-test') {
        this.activeTab.set(fragment);
      }
    });

    this.setupLivekitSubscriptions();
    this.loadBookingSlots();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.cleanup();
  }

  setActiveTab(tab: string): void {
    this.activeTab.set(tab as 'system-test' | 'availability');
    this.router.navigate([], { fragment: tab, replaceUrl: true });
  }

  private setupLivekitSubscriptions(): void {
    this.livekitService.connectionStatus$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(status => {
        this.connectionStatus.set(status);
      });

    this.livekitService.localVideoTrack$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(track => {
        if (this.localVideoTrack && this.videoElement?.nativeElement) {
          this.localVideoTrack.detach(this.videoElement.nativeElement);
        }
        this.localVideoTrack = track;
        if (track) {
          if (this.cameraStatus() === 'testing') {
            this.cameraStatus.set('working');
          }
          setTimeout(() => this.attachLocalVideo(), 50);
        }
      });

    this.livekitService.localAudioTrack$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(track => {
        this.localAudioTrack = track;
        if (track) {
          this.setupAudioVisualization(track);
          if (this.microphoneStatus() === 'testing') {
            this.microphoneStatus.set('working');
          }
        } else {
          this.stopAudioVisualization();
        }
      });

    this.livekitService.error$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(error => {
        this.toasterService.show('error', this.t.instant('common.error'), error);
      });
  }

  private async ensureConnected(): Promise<boolean> {
    if (this.livekitService.isConnected()) {
      return true;
    }

    if (this.isConnecting) {
      return false;
    }

    this.isConnecting = true;

    try {
      const config = await this.userService.getTestRtcInfo()
        .pipe(takeUntilDestroyed(this.destroyRef))
        .toPromise();

      if (!config) {
        throw new Error(this.t.instant('configuration.failedToGetTestInfo'));
      }

      await this.livekitService.connect({
        url: config.url,
        token: config.token,
        room: config.room,
      });

      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : this.t.instant('configuration.failedToConnect');
      this.toasterService.show('error', this.t.instant('configuration.connectionError'), message);
      return false;
    } finally {
      this.isConnecting = false;
    }
  }

  getConnectionStatusText(): string {
    switch (this.connectionStatus()) {
      case 'disconnected': return this.t.instant('configuration.connectionNotConnected');
      case 'connecting': return this.t.instant('configuration.connectionConnecting');
      case 'connected': return this.t.instant('configuration.connectionConnected');
      case 'reconnecting': return this.t.instant('configuration.connectionReconnecting');
      case 'failed': return this.t.instant('configuration.connectionFailed');
      default: return '';
    }
  }

  getConnectionStatusColor(): string {
    switch (this.connectionStatus()) {
      case 'connected': return 'var(--emerald-500)';
      case 'connecting':
      case 'reconnecting': return 'var(--amber-500)';
      case 'failed': return 'var(--rose-500)';
      default: return 'var(--slate-400)';
    }
  }

  getCameraStatusText(): string {
    switch (this.cameraStatus()) {
      case 'idle': return this.t.instant('configuration.statusNotTested');
      case 'testing': return this.t.instant('configuration.statusTesting');
      case 'working': return this.t.instant('configuration.statusWorking');
      case 'error': return this.t.instant('configuration.statusError');
      default: return '';
    }
  }

  getCameraPlaceholderText(): string {
    if (this.connectionStatus() === 'connecting') {
      return this.t.instant('configuration.connectingToServer');
    }
    switch (this.cameraStatus()) {
      case 'idle': return this.t.instant('configuration.cameraClickToBegin');
      case 'testing': return this.t.instant('configuration.cameraAccessing');
      case 'error': return this.t.instant('configuration.cameraDenied');
      default: return this.t.instant('configuration.cameraPreviewHere');
    }
  }

  async testCamera(): Promise<void> {
    this.cameraStatus.set('testing');

    try {
      const connected = await this.ensureConnected();
      if (!connected) {
        this.cameraStatus.set('error');
        return;
      }

      await this.livekitService.enableCamera(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : this.t.instant('configuration.cameraTestFailed');
      this.toasterService.show('error', this.t.instant('configuration.cameraError'), message);
      this.cameraStatus.set('error');
    }
  }

  private attachLocalVideo(): void {
    if (!this.videoElement?.nativeElement || !this.localVideoTrack) {
      return;
    }
    this.localVideoTrack.attach(this.videoElement.nativeElement);
  }

  async stopCamera(): Promise<void> {
    try {
      if (this.localVideoTrack && this.videoElement?.nativeElement) {
        this.localVideoTrack.detach(this.videoElement.nativeElement);
      }
      await this.livekitService.enableCamera(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : this.t.instant('configuration.failedToStopCamera');
      this.toasterService.show('error', this.t.instant('configuration.cameraError'), message);
    }
    this.cameraStatus.set('idle');
  }

  getMicrophoneStatusText(): string {
    switch (this.microphoneStatus()) {
      case 'idle': return this.t.instant('configuration.statusNotTested');
      case 'testing': return this.t.instant('configuration.statusTesting');
      case 'working': return this.t.instant('configuration.statusWorking');
      case 'error': return this.t.instant('configuration.statusError');
      default: return '';
    }
  }

  async testMicrophone(): Promise<void> {
    this.microphoneStatus.set('testing');

    try {
      const connected = await this.ensureConnected();
      if (!connected) {
        this.microphoneStatus.set('error');
        return;
      }

      await this.livekitService.enableMicrophone(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : this.t.instant('configuration.microphoneTestFailed');
      this.toasterService.show('error', this.t.instant('configuration.microphoneError'), message);
      this.microphoneStatus.set('error');
    }
  }

  async stopMicrophone(): Promise<void> {
    this.stopAudioVisualization();
    try {
      await this.livekitService.enableMicrophone(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : this.t.instant('configuration.failedToStopMicrophone');
      this.toasterService.show('error', this.t.instant('configuration.microphoneError'), message);
    }
    this.microphoneStatus.set('idle');
  }

  private setupAudioVisualization(track: LocalAudioTrack): void {
    this.stopAudioVisualization();
    try {
      const mediaStream = new MediaStream([track.mediaStreamTrack]);
      this.audioContext = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      const source = this.audioContext.createMediaStreamSource(mediaStream);
      this.analyserNode = this.audioContext.createAnalyser();
      this.analyserNode.fftSize = 64;
      source.connect(this.analyserNode);

      this.visualizeAudio();
    } catch (error) {
      this.toasterService.show('error', this.t.instant('configuration.audioError'), this.t.instant('configuration.audioVisualizationFailed'));
    }
  }

  private visualizeAudio(): void {
    if (!this.analyserNode) return;

    const bufferLength = this.analyserNode.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const analyze = () => {
      if (!this.analyserNode || this.microphoneStatus() !== 'working') return;

      this.analyserNode.getByteFrequencyData(dataArray);

      const bars = Array.from({ length: 20 }, (_, i) => {
        const dataIndex = Math.floor(i * bufferLength / 20);
        return (dataArray[dataIndex] / 255) * 100;
      });

      this.volumeBars.set(bars);
      this.animationFrame = requestAnimationFrame(analyze);
    };

    analyze();
  }

  private stopAudioVisualization(): void {
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
      this.analyserNode = null;
    }

    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }

    this.volumeBars.set(Array(20).fill(0));
  }

  getSpeakerStatusText(): string {
    switch (this.speakerStatus()) {
      case 'idle': return this.t.instant('configuration.statusNotTested');
      case 'playing': return this.t.instant('configuration.statusPlaying');
      case 'working': return this.t.instant('configuration.statusWorking');
      case 'error': return this.t.instant('configuration.statusError');
      default: return '';
    }
  }

  testSpeakers(): void {
    this.speakerStatus.set('playing');

    try {
      this.testAudio = new Audio();
      this.testAudio.src = this.generateTestTone();
      this.testAudio.play()
        .then(() => {
          setTimeout(() => {
            if (this.speakerStatus() === 'playing') {
              this.speakerStatus.set('idle');
            }
          }, 3000);
        })
        .catch(() => {
          this.toasterService.show('error', this.t.instant('configuration.speakerError'), this.t.instant('configuration.speakerTestFailed'));
          this.speakerStatus.set('error');
        });
    } catch (error) {
      this.toasterService.show('error', this.t.instant('configuration.speakerError'), this.t.instant('configuration.speakerSetupFailed'));
      this.speakerStatus.set('error');
    }
  }

  confirmSpeakers(): void {
    if (this.testAudio) {
      this.testAudio.pause();
      this.testAudio = null;
    }

    this.speakerStatus.set('working');
  }

  private generateTestTone(): string {
    const sampleRate = 44100;
    const duration = 2;
    const frequency = 440;
    const samples = duration * sampleRate;
    const buffer = new ArrayBuffer(44 + samples * 2);
    const view = new DataView(buffer);

    const writeString = (offset: number, string: string) => {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    };

    writeString(0, 'RIFF');
    view.setUint32(4, 36 + samples * 2, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(36, 'data');
    view.setUint32(40, samples * 2, true);

    let offset = 44;
    for (let i = 0; i < samples; i++) {
      const sample = Math.sin(2 * Math.PI * frequency * i / sampleRate) * 0.3;
      view.setInt16(offset, sample * 0x7FFF, true);
      offset += 2;
    }

    const blob = new Blob([buffer], { type: 'audio/wav' });
    return URL.createObjectURL(blob);
  }

  allTestsCompleted(): boolean {
    return this.cameraStatus() === 'working' &&
           this.microphoneStatus() === 'working' &&
           this.speakerStatus() === 'working';
  }

  async testAllSystems(): Promise<void> {
    const connected = await this.ensureConnected();
    if (!connected) {
      return;
    }

    if (this.cameraStatus() === 'idle') {
      await this.testCamera();
    }

    if (this.microphoneStatus() === 'idle') {
      await this.testMicrophone();
    }

    if (this.speakerStatus() === 'idle') {
      this.testSpeakers();
    }
  }

  loadBookingSlots(): void {
    this.isLoading.set(true);
    this.consultationService.getBookingSlots()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          this.bookingSlots.set(response.results);
          this.isLoading.set(false);
        },
        error: (error) => {
          this.logger.error('Error loading booking slots:', error);
          this.isLoading.set(false);
          this.toasterService.show('error', this.t.instant('configuration.errorLoadingSlots'), getErrorMessage(error));
        }
      });
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
              this.modalMode() === 'edit' ? this.t.instant('configuration.slotUpdated') : this.t.instant('configuration.slotCreated'),
              this.modalMode() === 'edit' ? this.t.instant('configuration.slotUpdatedMessage') : this.t.instant('configuration.slotCreatedMessage')
            );
            this.isSaving.set(false);
            this.closeSlotModal();
            this.loadBookingSlots();
          },
          error: (error) => {
            this.logger.error('Error saving time slot:', error);
            this.isSaving.set(false);
            this.toasterService.show('error', this.t.instant('configuration.errorSavingSlot'), this.t.instant('configuration.failedToSaveSlot'));
          }
        });
    } else {
      this.validationService.validateAllFormFields(this.slotForm);
      this.toasterService.show('error', this.t.instant('configuration.validationError'), this.t.instant('configuration.fillRequiredFields'));
    }
  }

  async confirmDeleteSlot(slot: BookingSlot): Promise<void> {
    const confirmed = await this.confirmationService.confirm({
      title: this.t.instant('configuration.deleteSlotTitle'),
      message: this.t.instant('configuration.deleteSlotMessage'),
      confirmText: this.t.instant('configuration.deleteConfirm'),
      cancelText: this.t.instant('configuration.deleteCancel'),
      confirmStyle: 'danger'
    });

    if (confirmed) {
      this.deleteSlot(slot);
    }
  }

  private deleteSlot(slot: BookingSlot): void {
    this.consultationService.deleteBookingSlot(slot.id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.toasterService.show('success', this.t.instant('configuration.slotDeleted'), this.t.instant('configuration.slotDeletedMessage'));
          this.loadBookingSlots();
        },
        error: (error) => {
          this.logger.error('Error deleting time slot:', error);
          this.toasterService.show('error', this.t.instant('configuration.errorDeletingSlot'), this.t.instant('configuration.failedToDeleteSlot'));
        }
      });
  }

  formatTimeForInput(timeString: string): string {
    return timeString.substring(0, 5);
  }

  getActiveDaysForSlot(slot: BookingSlot): string[] {
    const activeDays = [];
    if (slot.monday) activeDays.push(this.t.instant('configuration.dayMon'));
    if (slot.tuesday) activeDays.push(this.t.instant('configuration.dayTue'));
    if (slot.wednesday) activeDays.push(this.t.instant('configuration.dayWed'));
    if (slot.thursday) activeDays.push(this.t.instant('configuration.dayThu'));
    if (slot.friday) activeDays.push(this.t.instant('configuration.dayFri'));
    if (slot.saturday) activeDays.push(this.t.instant('configuration.daySat'));
    if (slot.sunday) activeDays.push(this.t.instant('configuration.daySun'));
    return activeDays;
  }

  getSlotTimeRange(slot: BookingSlot): string {
    const start = this.formatTimeForInput(slot.start_time);
    const end = this.formatTimeForInput(slot.end_time);
    return `${start} - ${end}`;
  }

  getBreakTimeRange(slot: BookingSlot): string {
    if (!slot.start_break || !slot.end_break) return this.t.instant('configuration.noBreak');
    const start = this.formatTimeForInput(slot.start_break);
    const end = this.formatTimeForInput(slot.end_break);
    return `${start} - ${end}`;
  }

  isFieldInvalid(formGroup: FormGroup, fieldName: string): boolean {
    return this.validationService.showError(formGroup, fieldName);
  }

  getFieldError(formGroup: FormGroup, fieldName: string): string {
    const field = formGroup.get(fieldName);
    if (field?.errors && field?.touched) {
      if (field.errors['required']) return this.t.instant('configuration.fieldRequired', { field: fieldName });
    }
    return '';
  }

  private cleanup(): void {
    if (this.localVideoTrack && this.videoElement?.nativeElement) {
      this.localVideoTrack.detach(this.videoElement.nativeElement);
    }

    this.stopAudioVisualization();

    if (this.testAudio) {
      this.testAudio.pause();
      this.testAudio = null;
    }

    this.livekitService.disconnect();
  }
}
