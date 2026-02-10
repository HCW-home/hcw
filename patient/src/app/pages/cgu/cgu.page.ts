import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  IonContent,
  IonButton,
  IonSpinner,
  NavController,
  ToastController,
} from '@ionic/angular/standalone';
import { Subject, takeUntil, switchMap, take, EMPTY } from 'rxjs';
import { AuthService } from '../../core/services/auth.service';
import { TermsService } from '../../core/services/terms.service';
import { ITerm } from '../../core/models/user.model';

@Component({
  selector: 'app-cgu',
  templateUrl: './cgu.page.html',
  styleUrls: ['./cgu.page.scss'],
  standalone: true,
  imports: [CommonModule, IonContent, IonButton, IonSpinner],
})
export class CguPage implements OnInit, OnDestroy {
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

  private loadTerm(): void {
    this.authService.currentUser$
      .pipe(
        take(1),
        takeUntil(this.destroy$),
        switchMap(user => {
          const termId = user?.main_organisation?.default_term;
          if (!termId) {
            this.navCtrl.navigateRoot('/home');
            return EMPTY;
          }
          return this.termsService.getTerm(termId);
        })
      )
      .subscribe({
        next: term => {
          this.term = term;
          this.loading = false;
        },
        error: async () => {
          this.loading = false;
          const toast = await this.toastController.create({
            message: 'Failed to load terms',
            duration: 3000,
            color: 'danger',
          });
          await toast.present();
        },
      });
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
            message: 'Failed to accept terms',
            duration: 3000,
            color: 'danger',
          });
          await toast.present();
        },
      });
  }
}
