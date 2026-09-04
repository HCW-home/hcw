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
      /* Angular binds [label] as a DOM property, not an attribute, so read the
       * property here — getAttribute('label') would be null even when set. */
      const named =
        (input as HTMLElement & { label?: string }).label ||
        input.getAttribute('aria-label') ||
        input.getAttribute('aria-labelledby');
      expect(named)
        .withContext(`ion-input[${input.getAttribute('formcontrolname')}] has no accessible name`)
        .toBeTruthy();
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
