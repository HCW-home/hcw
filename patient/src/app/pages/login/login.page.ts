import { Component, OnInit, inject } from "@angular/core";
import {
  IonContent,
  IonText,
  NavController,
} from "@ionic/angular/standalone";
import { ActivatedRoute } from "@angular/router";
import { Capacitor } from "@capacitor/core";
import { TranslatePipe } from "@ngx-translate/core";
import { MobileAppService } from "../../core/services/mobile-app.service";
import { AuthService } from "../../core/services/auth.service";
import { TranslationService } from "../../core/services/translation.service";
import { ActionHandlerService } from "../../core/services/action-handler.service";
import { DeeplinkService } from "../../core/services/deeplink.service";
import { LanguageSelectorComponent } from "../../shared/components/language-selector/language-selector.component";
import { AuthBrandingComponent } from '../../shared/components/auth-branding/auth-branding.component';
import { AuthFormComponent } from '../../shared/components/auth-form/auth-form.component';

@Component({
  selector: "app-login",
  templateUrl: "./login.page.html",
  styleUrls: ["./login.page.scss"],
  standalone: true,
  imports: [
    TranslatePipe,
    IonContent,
    IonText,
    LanguageSelectorComponent,
    AuthBrandingComponent,
    AuthFormComponent,
  ],
})
export class LoginPage implements OnInit {
  private t = inject(TranslationService);
  private mobileApp = inject(MobileAppService);
  private deeplinkService = inject(DeeplinkService);

  initialIdentifier = '';
  // Coming from a link received by mail/SMS: the recipient already knows which
  // account they own, so the form goes past the identifier step on its own.
  skipEmailStep = false;
  // Invite web users to open the native app (only before they sign in, and
  // never inside the native app itself).
  showDeeplinkBanner = false;
  // Native builds talk to the instance picked at first launch; let the user
  // switch away from it, otherwise a wrong URL locks them out of the app.
  isNative = Capacitor.isNativePlatform();
  activeHost = this.deeplinkService.getActiveHost();

  constructor(
    private route: ActivatedRoute,
    private authService: AuthService,
    private actionHandler: ActionHandlerService,
    private navCtrl: NavController,
  ) {}

  ngOnInit() {
    const email = this.route.snapshot.queryParamMap.get("email");
    const action = this.route.snapshot.queryParamMap.get("action");
    if (email) {
      this.initialIdentifier = email;
    }
    this.skipEmailStep = !!email && !!action;

    this.authService.getConfig().subscribe({
      next: (config: any) => {
        if (!config) return;
        // Only offer the native app on a certified instance — deep-linking to
        // an uncertified one would fail.
        this.showDeeplinkBanner =
          !!config.enable_deeplink &&
          !!config.instance_certified &&
          !Capacitor.isNativePlatform();
        if (config.languages?.length) {
          this.t.loadLanguages(config.languages);
        }
      },
    });
  }

  changeServer(): void {
    this.deeplinkService.openPicker();
  }

  /** Open the current instance in the native app (see MobileAppService). */
  openInApp(): void {
    this.mobileApp.openInApp();
  }

  navigateAfterAuth() {
    const action = this.route.snapshot.queryParamMap.get("action");
    const id = this.route.snapshot.queryParamMap.get("id");

    if (action) {
      this.actionHandler.navigateToAction(action, id);
    } else {
      this.navCtrl.navigateRoot("/home");
    }
  }

  goToRegister() {
    const action = this.route.snapshot.queryParamMap.get("action");
    this.navCtrl.navigateForward("/register", {
      queryParams: action ? { action } : {},
    });
  }

  forgotPassword(identifier: string): void {
    this.navCtrl.navigateForward("/forgot-password", { queryParams: { email: identifier } });
  }
}
