import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import {
  IonContent,
  IonCard,
  IonCardContent,
  IonIcon,
  IonText,
  IonButton,
  IonSpinner,
  NavController,
  ToastController
} from '@ionic/angular/standalone';
import { TranslatePipe } from '@ngx-translate/core';
import { Subject, takeUntil } from 'rxjs';
import { UserService } from '../../core/services/user.service';
import { TranslationService } from '../../core/services/translation.service';
import { AppHeaderComponent } from '../../shared/app-header/app-header.component';
import { AppFooterComponent } from '../../shared/app-footer/app-footer.component';

@Component({
  selector: 'app-confirm-visibility',
  templateUrl: './confirm-visibility.page.html',
  styleUrls: ['./confirm-visibility.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    IonContent,
    IonCard,
    IonCardContent,
    IonIcon,
    IonText,
    IonButton,
    IonSpinner,
    TranslatePipe,
    AppHeaderComponent,
    AppFooterComponent
  ]
})
export class ConfirmVisibilityPage implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  private t = inject(TranslationService);

  isLoading = true;
  isConfirming = false;
  isDone = false;
  errorMessage: string | null = null;
  organisationName: string | null = null;
  requestedByName: string | null = null;
  private grantId: number | null = null;

  constructor(
    private route: ActivatedRoute,
    private userService: UserService,
    private navCtrl: NavController,
    private toastCtrl: ToastController
  ) {}

  ngOnInit(): void {
    const idParam = this.route.snapshot.paramMap.get('id');
    this.grantId = idParam ? parseInt(idParam, 10) : null;
    if (!this.grantId) {
      this.isLoading = false;
      this.errorMessage = this.t.instant('confirmVisibility.invalidLink');
      return;
    }
    this.userService.getVisibilityGrant(this.grantId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (grant) => {
          this.isLoading = false;
          if (grant.confirmed) {
            this.isDone = true;
            return;
          }
          this.organisationName = grant.organisation_name;
          this.requestedByName = grant.requested_by_name;
        },
        error: () => {
          this.isLoading = false;
          this.errorMessage = this.t.instant('confirmVisibility.failedLoad');
        }
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  confirm(): void {
    if (!this.grantId) {
      return;
    }
    this.isConfirming = true;
    this.userService.confirmVisibilityGrant(this.grantId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: async () => {
          this.isConfirming = false;
          this.isDone = true;
          const toast = await this.toastCtrl.create({
            message: this.t.instant('confirmVisibility.confirmSuccess'),
            duration: 2000,
            position: 'top',
            color: 'success'
          });
          await toast.present();
          setTimeout(() => {
            this.navCtrl.navigateRoot('/home');
          }, 1500);
        },
        error: async () => {
          this.isConfirming = false;
          const toast = await this.toastCtrl.create({
            message: this.t.instant('confirmVisibility.failedConfirm'),
            duration: 2000,
            position: 'top',
            color: 'danger'
          });
          await toast.present();
        }
      });
  }

  goToHome(): void {
    this.navCtrl.navigateRoot('/home');
  }
}