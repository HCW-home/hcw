import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { provideIonicAngular } from '@ionic/angular/standalone';
import { TranslateModule } from '@ngx-translate/core';
import { IonicStorageModule } from '@ionic/storage-angular';
import { importProvidersFrom } from '@angular/core';
import { axe, toHaveNoViolations } from 'jasmine-axe';

import { AuthFormComponent } from './auth-form.component';

/**
 * Accessibility regression test for the sign-in form.
 *
 * This component is the way into the application: if it is not usable with a
 * keyboard and a screen reader, nothing behind it is reachable either. It is
 * therefore the first place worth guarding.
 *
 * Scope note: axe covers roughly a third of WCAG automatically. It will catch a
 * control losing its label or an aria-* attribute going stale, but it cannot
 * judge focus order or whether an announcement makes sense. Manual passes with
 * NVDA or Orca stay necessary.
 */
describe('AuthFormComponent accessibility', () => {
  let fixture: ComponentFixture<AuthFormComponent>;

  beforeEach(async () => {
    jasmine.addMatchers(toHaveNoViolations);

    await TestBed.configureTestingModule({
      imports: [AuthFormComponent, TranslateModule.forRoot()],
      providers: [
        provideIonicAngular({ animated: false }),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        importProvidersFrom(IonicStorageModule.forRoot()),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AuthFormComponent);
  });

  /**
   * Ionic components are Stencil custom elements and hydrate asynchronously.
   * Without waiting, axe inspects an empty shell and the test passes for the
   * wrong reason.
   */
  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise(resolve => setTimeout(resolve, 0));
    fixture.detectChanges();
  }

  it('has no violations on the identifier step', async () => {
    fixture.componentInstance.mode = 'login';
    await settle();
    expect(await axe(fixture.nativeElement)).toHaveNoViolations();
  });

  it('has no violations on the password step', async () => {
    fixture.componentInstance.mode = 'login';
    fixture.componentInstance.step = 'credentials';
    await settle();
    expect(await axe(fixture.nativeElement)).toHaveNoViolations();
  });

  it('has no violations on the verification-code step', async () => {
    fixture.componentInstance.step = 'verification';
    await settle();
    expect(await axe(fixture.nativeElement)).toHaveNoViolations();
  });

  it('labels every input, so none rely on placeholder text alone', async () => {
    fixture.componentInstance.mode = 'login';
    await settle();

    const inputs: NodeListOf<HTMLElement> =
      fixture.nativeElement.querySelectorAll('ion-input');
    expect(inputs.length).toBeGreaterThan(0);

    inputs.forEach(input => {
      /* Labels sit above the field as their own <label>, associated by
       * aria-labelledby rather than for/id — Ionic generates the inner input's
       * id itself and gives no way to set it. Assert both the reference and
       * that it resolves to a real element. */
      /* Ionic strips aria-labelledby from the host and re-applies it to the
       * inner native input, so look there first. In Material mode that input
       * lives in the light DOM, not a shadow root. */
      const nativeInput =
        input.querySelector('input, textarea') ??
        input.shadowRoot?.querySelector('input, textarea');
      const labelledBy =
        nativeInput?.getAttribute('aria-labelledby') ?? input.getAttribute('aria-labelledby');
      const named = labelledBy || input.getAttribute('aria-label');
      expect(named)
        .withContext(`ion-input[${input.getAttribute('formcontrolname')}] has no accessible name`)
        .toBeTruthy();

      if (labelledBy) {
        const target = fixture.nativeElement.querySelector(`#${labelledBy}`);
        expect(target)
          .withContext(`aria-labelledby="${labelledBy}" points at nothing`)
          .toBeTruthy();
        expect(target?.textContent?.trim()).toBeTruthy();
      }
    });
  });

  it('exposes the password toggle as a button with a label', async () => {
    fixture.componentInstance.step = 'credentials';
    await settle();

    const toggle: HTMLElement | null =
      fixture.nativeElement.querySelector('button.password-toggle');
    expect(toggle).withContext('password toggle should be a real button').toBeTruthy();
    expect(toggle?.getAttribute('aria-label')).toBeTruthy();
    expect(toggle?.getAttribute('aria-pressed')).toBe('false');
  });

  it('stays quiet when an empty required field is merely touched', async () => {
    fixture.componentInstance.mode = 'login';
    await settle();

    const control = fixture.componentInstance.identifierForm.get('identifier');
    control?.markAsTouched();
    await settle();

    /* Ionic reveals errorText as soon as a control is touched and invalid, and
     * an empty required field is invalid from the outset. Reporting it here
     * turned the label red and printed "enter a valid email" before the user
     * had typed anything. */
    expect(fixture.componentInstance.identifierErrorText)
      .withContext('an untouched-but-empty field is not an error yet')
      .toBe('');

    const input: HTMLElement = fixture.nativeElement.querySelector('ion-input');
    expect(input.classList.contains('has-error')).toBe(false);
  });

  it('reports a genuine validation failure', async () => {
    fixture.componentInstance.step = 'credentials';
    await settle();

    const control = fixture.componentInstance.passwordForm.get('password');
    control?.setValue('abc');
    control?.markAsTouched();
    await settle();

    expect(fixture.componentInstance.passwordErrorText).toBeTruthy();

    const input: HTMLElement = fixture.nativeElement.querySelector('ion-input');
    expect(input.classList.contains('has-error'))
      .withContext('a real failure must still turn the field red')
      .toBe(true);
  });

  it('uses buttons, not ion-text, for the in-form navigation links', async () => {
    fixture.componentInstance.step = 'credentials';
    fixture.componentInstance.patientPasswordLoginEnabled = true;
    await settle();

    /* These were <ion-text (click)> and thus unreachable by keyboard: forgot
     * password, resend code, switch mode. Assert they never regress. */
    const clickableText = fixture.nativeElement.querySelectorAll('ion-text.link-text');
    expect(clickableText.length)
      .withContext('link-text must be rendered as <button>, not <ion-text>')
      .toBe(0);
  });
});
