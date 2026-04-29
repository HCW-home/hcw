import { Component, OnInit, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import {
  FormBuilder,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { TranslatePipe } from '@ngx-translate/core';

import { UserService } from '../../core/services/user.service';
import { Auth } from '../../core/services/auth';
import { EncryptionService } from '../../core/services/encryption.service';
import { ToasterService } from '../../core/services/toaster.service';
import { TranslationService } from '../../core/services/translation.service';
import { ThemeService } from '../../core/services/theme.service';
import { RoutePaths } from '../../core/constants/routes';
import { IUser } from '../../modules/user/models/user';

import { Typography } from '../../shared/ui-components/typography/typography';
import { Button } from '../../shared/ui-components/button/button';
import { Loader } from '../../shared/components/loader/loader';
import { TypographyTypeEnum } from '../../shared/constants/typography';
import { ButtonTypeEnum, ButtonStyleEnum } from '../../shared/constants/button';

@Component({
  selector: 'app-activate-encryption',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    TranslatePipe,
    Typography,
    Button,
    Loader,
  ],
  templateUrl: './activate-encryption.html',
  styleUrl: './activate-encryption.scss',
})
export class ActivateEncryptionPage implements OnInit {
  private router = inject(Router);
  private fb = inject(FormBuilder);
  private userService = inject(UserService);
  private authService = inject(Auth);
  private encryptionService = inject(EncryptionService);
  private toasterService = inject(ToasterService);
  private t = inject(TranslationService);
  private themeService = inject(ThemeService);

  TypographyTypeEnum = TypographyTypeEnum;
  ButtonTypeEnum = ButtonTypeEnum;
  ButtonStyleEnum = ButtonStyleEnum;

  form!: FormGroup;
  loading = true;
  saving = signal(false);
  user: IUser | null = null;
  newPassphraseShown = signal<string | null>(null);

  siteLogoWhite: string | null = null;
  branding = 'HCW@Home';

  async ngOnInit(): Promise<void> {
    this.form = this.fb.group({
      passphrase: ['', [Validators.required]],
    });

    try {
      const config = await firstValueFrom(this.authService.getOpenIDConfig());
      this.siteLogoWhite = config?.main_organization?.logo_white || null;
      if (config?.branding) {
        this.branding = config.branding;
      }
      if (config?.primary_color_practitioner) {
        this.themeService.applyPrimaryColor(config.primary_color_practitioner);
      }
      this.user = await firstValueFrom(this.userService.getCurrentUser());
    } catch {
      // ignore, page still usable
    }
    this.loading = false;
  }

  async submit(): Promise<void> {
    if (this.form.invalid || this.saving() || !this.user) {
      return;
    }
    this.saving.set(true);
    try {
      await this.encryptionService.activatePassphrase(
        this.user.pk,
        this.form.value.passphrase,
      );
      this.router.navigate([`/${RoutePaths.USER}`]);
    } catch {
      this.saving.set(false);
      this.toasterService.show(
        'error',
        this.t.instant('activateEncryption.errorTitle'),
        this.t.instant('activateEncryption.invalidPassphrase'),
      );
    }
  }

  async forgotPassphrase(): Promise<void> {
    if (!confirm(this.t.instant('activateEncryption.forgotConfirm'))) {
      return;
    }
    try {
      const response = await this.encryptionService.forgotPassphrase();
      this.newPassphraseShown.set(response.passphrase);
      this.form.patchValue({ passphrase: response.passphrase });
    } catch {
      this.toasterService.show(
        'error',
        this.t.instant('activateEncryption.errorTitle'),
        this.t.instant('activateEncryption.forgotFailed'),
      );
    }
  }
}
