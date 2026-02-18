import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  IonContent,
  IonButton,
  IonSpinner,
  NavController,
  ToastController,
} from '@ionic/angular/standalone';
import { TranslatePipe } from '@ngx-translate/core';
import { Subject, takeUntil, switchMap, take, EMPTY, firstValueFrom } from 'rxjs';
import { AuthService } from '../../core/services/auth.service';
import { TermsService } from '../../core/services/terms.service';
import { TranslationService } from '../../core/services/translation.service';
import { ITerm } from '../../core/models/user.model';

@Component({
  selector: 'app-terms',
  templateUrl: './terms.page.html',
  styleUrls: ['./terms.page.scss'],
  standalone: true,
  imports: [CommonModule, IonContent, IonButton, IonSpinner, TranslatePipe],
})
export class TermsPage implements OnInit, OnDestroy {
  private t = inject(TranslationService);
  private destroy$ = new Subject<void>();

  term: ITerm | null = null;
  loading = true;
  accepting = false;

  constructor(
    private authService: AuthService,
    private termsService: TermsService,
    private navCtrl: NavController,
    private toastController: ToastController
  ) {}

  ngOnInit(): void {
    this.loadTerm();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private async loadTerm(): Promise<void> {
    try {
      const user = this.authService.currentUserValue;
      let termId = user?.main_organisation?.default_term;

      // Fallback to main organization from app config
      if (!termId) {
        try {
          const config = await firstValueFrom(this.authService.getConfig());
          termId = config?.main_organization?.default_term;
        } catch {
          // Ignore config fetch errors
        }
      }

      if (!termId) {
        this.navCtrl.navigateRoot('/home');
        return;
      }

      const term = await firstValueFrom(this.termsService.getTerm(termId));
      this.term = term;
      this.loading = false;
    } catch {
      this.loading = false;
      const toast = await this.toastController.create({
        message: this.t.instant('terms.failedLoad'),
        duration: 3000,
        color: 'danger',
      });
      await toast.present();
    }
  }

  onAccept(): void {
    if (!this.term) return;

    this.accepting = true;
    this.termsService
      .acceptTerm(this.term.id)
      .pipe(
        takeUntil(this.destroy$),
        switchMap(() => this.authService.getCurrentUser())
      )
      .subscribe({
        next: () => {
          this.navCtrl.navigateRoot('/home');
        },
        error: async () => {
          this.accepting = false;
          const toast = await this.toastController.create({
            message: this.t.instant('terms.failedAccept'),
            duration: 3000,
            color: 'danger',
          });
          await toast.present();
        },
      });
  }
}
