import { Component, OnInit, OnDestroy, inject } from "@angular/core";
import {
  IonApp,
  IonRouterOutlet,
  NavController,
} from "@ionic/angular/standalone";
import { Title } from "@angular/platform-browser";
import { Router } from "@angular/router";
import { Subject, firstValueFrom, takeUntil } from "rxjs";
import { Capacitor } from "@capacitor/core";
import { AuthService } from "./core/services/auth.service";
import { UserWebSocketService } from "./core/services/user-websocket.service";
import { NotificationService } from "./core/services/notification.service";
import { IncomingCallService } from "./core/services/incoming-call.service";
import { ActionHandlerService } from "./core/services/action-handler.service";
import { ConsultationService } from "./core/services/consultation.service";
import { IncomingCallComponent } from "./shared/components/incoming-call/incoming-call.component";
import { OfflineIndicatorComponent } from "./shared/components/offline-indicator/offline-indicator.component";
import { MaintenanceOverlayComponent } from "./shared/components/maintenance-overlay/maintenance-overlay.component";
import { TranslationService } from "./core/services/translation.service";
import { PushNotificationService } from "./core/services/push-notification.service";
import { BrowserNotificationService } from "./core/services/browser-notification.service";
import { AppUpdateService } from "./core/services/app-update.service";
import { DeeplinkService } from "./core/services/deeplink.service";

@Component({
  selector: "app-root",
  templateUrl: "app.component.html",
  styleUrls: ["app.component.scss"],
  imports: [IonApp, IonRouterOutlet, IncomingCallComponent, OfflineIndicatorComponent, MaintenanceOverlayComponent],
})
export class AppComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  private titleService = inject(Title);
  private translationService = inject(TranslationService);
  private pushNotificationService = inject(PushNotificationService);
  private browserNotificationService = inject(BrowserNotificationService);
  private appUpdateService = inject(AppUpdateService);
  private deeplinkService = inject(DeeplinkService);

  private notificationService = inject(NotificationService);

  constructor(
    private authService: AuthService,
    private userWsService: UserWebSocketService,
    private incomingCallService: IncomingCallService,
    private actionHandler: ActionHandlerService,
    private consultationService: ConsultationService,
    private navCtrl: NavController,
    private router: Router,
  ) {}

  ngOnInit(): void {
    this.unregisterServiceWorkerOnNative();
    this.deeplinkService.initialize();
    this.handleDeepLinks();
    this.setupWebSocketSubscriptions();
    this.loadBranding();
    this.appUpdateService.initialize();

    this.authService.isAuthenticated$
      .pipe(takeUntil(this.destroy$))
      .subscribe((isAuthenticated: boolean) => {
        if (isAuthenticated) {
          this.userWsService.connect();
          this.browserNotificationService.requestPermission();
          this.pushNotificationService.subscribe();
        } else {
          this.userWsService.disconnect();
        }
      });
  }

  /**
   * On native, remove any service worker a previous APK build may have
   * registered (and its caches). The bundled APK is always the latest build,
   * so a lingering SW would only serve stale assets and trigger bogus
   * "new version available" prompts.
   */
  private unregisterServiceWorkerOnNative(): void {
    if (!Capacitor.isNativePlatform() || !('serviceWorker' in navigator)) {
      return;
    }
    navigator.serviceWorker.getRegistrations()
      .then((registrations) => registrations.forEach((r) => r.unregister()))
      .catch(() => undefined);
    if (typeof caches !== 'undefined') {
      caches.keys()
        .then((keys) => keys.filter((k) => k.startsWith('ngsw:')).forEach((k) => caches.delete(k)))
        .catch(() => undefined);
    }
  }

  private setupWebSocketSubscriptions(): void {
    this.userWsService.appointmentJoined$
      .pipe(takeUntil(this.destroy$))
      .subscribe((event) => {
        if (this.router.url.includes("/video")) {
          return;
        }

        this.incomingCallService.showIncomingCall({
          callerName: event.data.user_name,
          appointmentId: event.appointment_id,
          consultationId: event.consultation_id,
          type: 'appointment',
        });
      });

    this.userWsService.callRequest$
      .pipe(takeUntil(this.destroy$))
      .subscribe((event) => {
        if (this.router.url.includes("/video")) {
          return;
        }

        this.incomingCallService.showIncomingCall({
          callerName: event.caller_name,
          consultationId: event.consultation_id,
          type: 'consultation',
        });
      });

    // Increment unread notification count on new WS notification
    this.userWsService.notifications$
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        this.notificationService.incrementUnreadCount();
      });

    // When patient dismisses a consultation call, notify the doctor
    this.incomingCallService.callDismissed$
      .pipe(takeUntil(this.destroy$))
      .subscribe(({ consultationId }) => {
        this.consultationService
          .respondToCall(consultationId, false)
          .subscribe();
      });

    // When patient accepts a consultation call, notify the doctor
    this.incomingCallService.callAccepted$
      .pipe(takeUntil(this.destroy$))
      .subscribe(({ consultationId }) => {
        this.consultationService
          .respondToCall(consultationId, true)
          .subscribe();
      });
  }

  private async handleDeepLinks(): Promise<void> {
    const urlParams = new URLSearchParams(window.location.search);
    const authToken = urlParams.get("auth");
    const action = urlParams.get("action");
    const actionId = urlParams.get("id");
    const email = urlParams.get("email");
    const uid = urlParams.get("uid");
    const token = urlParams.get("token");

    // Verification now happens with a code typed into the app. Links sent
    // before that change still carry ?token=, which is ignored: the page only
    // needs the identifier to let the recipient ask for a fresh code.
    if (action === "verify-email") {
      this.navCtrl.navigateRoot(["/verify"], {
        queryParams: email ? { identifier: email } : {},
      });
      return;
    }

    if (uid && token) {
      this.navCtrl.navigateRoot(["/reset-password"], {
        queryParams: { uid, token },
      });
      return;
    }

    if (authToken || email) {
      // The link targets one specific account: when we are already signed in as
      // that very account, follow the link instead of asking to authenticate
      // again.
      if (await this.isLinkForCurrentUser(email, action, actionId)) {
        this.actionHandler.navigateToAction(action, actionId);
        return;
      }

      if (authToken) {
        const queryParams: Record<string, string> = { auth: authToken };
        if (action) queryParams["action"] = action;
        if (actionId) queryParams["id"] = actionId;
        this.navCtrl.navigateRoot(["/verify-invite"], { queryParams });
      } else {
        this.navCtrl.navigateRoot(["/login"], {
          queryParams: { email, action, id: actionId },
        });
      }
      return;
    }

    if (action && actionId) {
      this.actionHandler.navigateToAction(action, actionId);
    }
  }

  /**
   * Tell whether a received link belongs to the account currently signed in.
   * The email carried by the link is compared to the current user; a magic-link
   * token cannot be matched client-side, so participant-based actions are
   * checked against /user/participants/, which only exposes the current user's
   * own participations.
   */
  private async isLinkForCurrentUser(
    email: string | null,
    action: string | null,
    actionId: string | null,
  ): Promise<boolean> {
    await this.authService.authReady;
    if (!this.authService.isAuthenticatedValue) {
      return false;
    }

    if (email) {
      const currentEmail = this.authService.currentUserValue?.email;
      return (
        !!currentEmail && currentEmail.toLowerCase() === email.toLowerCase()
      );
    }

    if (actionId && (action === "join" || action === "presence")) {
      try {
        await firstValueFrom(
          this.consultationService.getParticipantById(Number(actionId)),
        );
        return true;
      } catch {
        return false;
      }
    }

    return false;
  }

  private loadBranding(): void {
    this.authService
      .getConfig()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (config: any) => {
          if (config?.branding) {
            this.titleService.setTitle(config.branding);
          }
          if (config?.languages?.length) {
            this.translationService.loadLanguages(config.languages);
          }
          if (config?.site_favicon) {
            const link: HTMLLinkElement =
              document.querySelector("link[rel~='icon']") ||
              document.createElement("link");
            link.rel = "icon";
            link.href = config.site_favicon;
            document.head.appendChild(link);
          }
          if (config?.vapid_public_key) {
            this.pushNotificationService.setVapidPublicKey(config.vapid_public_key);
          }
          if (config?.primary_color_patient) {
            this.applyPrimaryColor(config.primary_color_patient);
          }
        },
      });
  }

  private applyPrimaryColor(hex: string): void {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    const toHex = (v: number) => Math.min(255, Math.max(0, Math.round(v))).toString(16).padStart(2, "0");
    const mix = (v: number, target: number, w: number) => Math.round(v + (target - v) * w);
    const lighten = (w: number) => `#${toHex(mix(r, 255, w))}${toHex(mix(g, 255, w))}${toHex(mix(b, 255, w))}`;
    const darken = (w: number) => `#${toHex(mix(r, 0, w))}${toHex(mix(g, 0, w))}${toHex(mix(b, 0, w))}`;

    const root = document.documentElement.style;
    root.setProperty("--ion-color-primary", hex);
    root.setProperty("--ion-color-primary-rgb", `${r}, ${g}, ${b}`);
    root.setProperty("--ion-color-primary-shade", darken(0.15));
    root.setProperty("--ion-color-primary-tint", lighten(0.3));
    root.setProperty("--ion-color-primary-light", lighten(0.6));
    root.setProperty("--ion-color-primary-dark", darken(0.15));
    root.setProperty("--ion-color-primary-bg", lighten(0.95));
    root.setProperty("--app-primary-bg", lighten(0.95));
    root.setProperty("--app-background", lighten(0.97));
    root.setProperty("--app-background-secondary", lighten(0.93));
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.userWsService.disconnect();
  }
}
