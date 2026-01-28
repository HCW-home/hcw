import { Component, signal, inject, OnInit, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject, takeUntil, debounceTime, distinctUntilChanged } from 'rxjs';
import { Page } from '../../../../core/components/page/page';
import { Svg } from '../../../../shared/ui-components/svg/svg';
import { Typography } from '../../../../shared/ui-components/typography/typography';
import { Button } from '../../../../shared/ui-components/button/button';
import { Input } from '../../../../shared/ui-components/input/input';
import { Loader } from '../../../../shared/components/loader/loader';
import { Badge } from '../../../../shared/components/badge/badge';
import { ModalComponent } from '../../../../shared/components/modal/modal.component';
import { AddEditPatient } from '../add-edit-patient/add-edit-patient';
import { TypographyTypeEnum } from '../../../../shared/constants/typography';
import { ButtonSizeEnum, ButtonStyleEnum } from '../../../../shared/constants/button';
import { RoutePaths } from '../../../../core/constants/routes';
import { PatientService } from '../../../../core/services/patient.service';
import { ToasterService } from '../../../../core/services/toaster.service';
import { IUser } from '../../models/user';
import { getOnlineStatusBadgeType } from '../../../../shared/tools/helper';
import { getErrorMessage } from '../../../../core/utils/error-helper';

@Component({
  selector: 'app-patients',
  imports: [CommonModule, FormsModule, Page, Svg, Typography, Button, Input, Loader, Badge, ModalComponent, AddEditPatient],
  templateUrl: './patients.html',
  styleUrl: './patients.scss',
})
export class Patients implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  private searchSubject$ = new Subject<string>();
  private patientService = inject(PatientService);
  private toasterService = inject(ToasterService);
  private router = inject(Router);

  protected readonly TypographyTypeEnum = TypographyTypeEnum;
  protected readonly ButtonSizeEnum = ButtonSizeEnum;
  protected readonly ButtonStyleEnum = ButtonStyleEnum;
  protected readonly getOnlineStatusBadgeType = getOnlineStatusBadgeType;

  loading = signal(false);
  patients = signal<IUser[]>([]);
  totalCount = signal(0);
  searchQuery = '';
  showAddModal = signal(false);

  ngOnInit(): void {
    this.loadPatients();

    this.searchSubject$.pipe(
      debounceTime(300),
      distinctUntilChanged(),
      takeUntil(this.destroy$)
    ).subscribe(query => {
      this.searchQuery = query;
      this.loadPatients();
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadPatients(): void {
    this.loading.set(true);
    const params: { search?: string; page_size?: number } = { page_size: 50 };
    if (this.searchQuery) {
      params.search = this.searchQuery;
    }

    this.patientService.getPatients(params).pipe(
      takeUntil(this.destroy$)
    ).subscribe({
      next: (response) => {
        this.patients.set(response.results);
        this.totalCount.set(response.count);
        this.loading.set(false);
      },
      error: (err) => {
        this.toasterService.show('error', 'Error', getErrorMessage(err));
        this.loading.set(false);
      }
    });
  }

  onSearchChange(query: string): void {
    this.searchSubject$.next(query);
  }

  getInitials(patient: IUser): string {
    const first = patient.first_name?.charAt(0) || '';
    const last = patient.last_name?.charAt(0) || '';
    return (first + last).toUpperCase() || 'U';
  }

  getFullName(patient: IUser): string {
    return `${patient.first_name || ''} ${patient.last_name || ''}`.trim() || patient.email;
  }

  viewPatient(patient: IUser): void {
    this.router.navigate([RoutePaths.USER, 'patients', patient.pk]);
  }

  openAddModal(): void {
    this.showAddModal.set(true);
  }

  closeAddModal(): void {
    this.showAddModal.set(false);
  }

  onPatientCreated(): void {
    this.closeAddModal();
    this.loadPatients();
  }
}
