import { Component, OnInit } from "@angular/core";
import {
  IonContent,
  IonIcon,
  NavController,
} from "@ionic/angular/standalone";
import { TranslatePipe } from "@ngx-translate/core";
import { ActivatedRoute } from "@angular/router";
import { AuthService } from "../../core/services/auth.service";
import { ActionHandlerService } from "../../core/services/action-handler.service";
import { LanguageSelectorComponent } from "../../shared/components/language-selector/language-selector.component";
import { AuthBrandingComponent } from '../../shared/components/auth-branding/auth-branding.component';
import { AuthFormComponent } from '../../shared/components/auth-form/auth-form.component';

@Component({
  selector: "app-register",
  templateUrl: "./register.page.html",
  styleUrls: ["./register.page.scss"],
  standalone: true,
  imports: [
    IonContent,
    IonIcon,
    TranslatePipe,
    LanguageSelectorComponent,
    AuthBrandingComponent,
    AuthFormComponent,
  ],
})
export class RegisterPage implements OnInit {
  registrationEnabled = true;
  loading = true;
  /** Action carried over from a link, replayed once signed in. */
  returnAction: string | null = null;

  constructor(
    private authService: AuthService,
    private actionHandler: ActionHandlerService,
    private navCtrl: NavController,
    private route: ActivatedRoute,
  ) {}

  ngOnInit() {
    this.returnAction = this.route.snapshot.queryParamMap.get('action');

    this.authService.getConfig().subscribe({
      // getConfig() emits null when the backend is unreachable.
      next: (config: any) => {
        this.registrationEnabled =
          !!config?.registration_enabled && !config?.force_temporary_patients;
        this.loading = false;
      },
      error: () => {
        this.registrationEnabled = false;
        this.loading = false;
      },
    });
  }

  // Verifying the code signs the brand-new account in, so carry on where the
  // user was headed. FirstLoginGuard sends them to onboarding if needed.
  onAuthenticated(): void {
    if (this.returnAction) {
      this.actionHandler.navigateToAction(this.returnAction, null);
    } else {
      this.navCtrl.navigateRoot('/home');
    }
  }

  goToLogin() {
    this.navCtrl.navigateBack("/login", {
      queryParams: this.returnAction ? { action: this.returnAction } : {},
    });
  }
}
