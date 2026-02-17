import { Component, OnInit } from "@angular/core";
import { CommonModule } from "@angular/common";
import {
  FormBuilder,
  FormGroup,
  Validators,
  ReactiveFormsModule,
} from "@angular/forms";
import {
  IonContent,
  IonItem,
  IonInput,
  IonButton,
  IonIcon,
  IonText,
  NavController,
  LoadingController,
  ToastController,
} from "@ionic/angular/standalone";
import { ActivatedRoute } from "@angular/router";
import { AuthService } from "../../core/services/auth.service";
import { ActionHandlerService } from "../../core/services/action-handler.service";
import { ConsultationService } from "../../core/services/consultation.service";

@Component({
  selector: "app-login",
  templateUrl: "./login.page.html",
  styleUrls: ["./login.page.scss"],
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    IonContent,
    IonItem,
    IonInput,
    IonButton,
    IonIcon,
    IonText,
  ],
})
export class LoginPage implements OnInit {
  loginForm: FormGroup;
  showPassword = false;
  registrationEnabled = false;
  siteLogoWhite: string | null = null;
  branding = "HCW@Home";

  constructor(
    private fb: FormBuilder,
    private route: ActivatedRoute,
    private authService: AuthService,
    private actionHandler: ActionHandlerService,
    private consultationService: ConsultationService,
    private navCtrl: NavController,
    private loadingCtrl: LoadingController,
    private toastCtrl: ToastController,
  ) {
    this.loginForm = this.fb.group({
      email: ["patient@gmail.com", [Validators.required, Validators.email]],
      password: [
        "nHVih82Umdv@Qtk",
        [Validators.required, Validators.minLength(6)],
      ],
    });
  }

  ngOnInit() {
    const email = this.route.snapshot.queryParamMap.get("email");
    if (email) {
      this.loginForm.patchValue({ email });
    }
    this.authService.getConfig().subscribe({
      next: (config: any) => {
        this.registrationEnabled = config.registration_enabled;
        this.siteLogoWhite = config.site_logo_white;
        if (config.branding) {
          this.branding = config.branding;
        }
      },
    });
  }

  togglePassword() {
    this.showPassword = !this.showPassword;
  }

  async onLogin() {
    if (this.loginForm.valid) {
      const loading = await this.loadingCtrl.create({
        message: "Logging in...",
        spinner: "crescent",
      });
      await loading.present();

      this.authService.login(this.loginForm.value).subscribe({
        next: async (response) => {
          await loading.dismiss();

          const action = this.route.snapshot.queryParamMap.get("action");
          const id = this.route.snapshot.queryParamMap.get("id");

          if (action === "join" && id) {
            this.consultationService.getParticipantById(Number(id)).subscribe({
              next: (participant) => {
                const consultation = participant.appointment.consultation;
                const consultationId =
                  typeof consultation === "object"
                    ? (consultation as { id: number }).id
                    : consultation;
                this.navCtrl.navigateRoot(
                  `/consultation/${participant.appointment.id}/video`,
                  { queryParams: { type: "appointment", consultationId } },
                );
              },
              error: () => {
                this.navCtrl.navigateRoot(`/confirm-presence/${id}`);
              },
            });
          } else if (action) {
            const route = this.actionHandler.getRouteForAction(action, id);
            this.navCtrl.navigateRoot(route);
          } else {
            this.navCtrl.navigateRoot("/home");
          }
        },
        error: async (error) => {
          await loading.dismiss();
          const toast = await this.toastCtrl.create({
            message:
              error.error?.detail || "Invalid credentials. Please try again.",
            duration: 3000,
            position: "top",
            color: "danger",
          });
          await toast.present();
        },
      });
    }
  }

  goToRegister() {
    this.navCtrl.navigateForward("/register");
  }

  forgotPassword(): void {
    this.navCtrl.navigateForward("/forgot-password");
  }
}
