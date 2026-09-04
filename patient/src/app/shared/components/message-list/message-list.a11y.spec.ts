import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { provideIonicAngular } from '@ionic/angular/standalone';
import { TranslateModule } from '@ngx-translate/core';
import { IonicStorageModule } from '@ionic/storage-angular';
import { importProvidersFrom } from '@angular/core';

import { MessageListComponent } from './message-list';

/**
 * The image viewer must not close when the backdrop is clicked.
 *
 * Backdrop dismissal is a pointer-only affordance with no keyboard or screen
 * reader equivalent, and a stray click next to a full-screen image should not
 * discard it. Closing goes through the header button or Escape.
 */
describe('MessageListComponent image viewer dismissal', () => {
  let fixture: ComponentFixture<MessageListComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MessageListComponent, TranslateModule.forRoot()],
      providers: [
        provideIonicAngular({ animated: false }),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        importProvidersFrom(IonicStorageModule.forRoot()),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(MessageListComponent);
    fixture.componentInstance.messages = [];
    fixture.detectChanges();
  });

  function openViewer(): void {
    fixture.componentInstance.viewingImage.set({
      url: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=',
      fileName: 'scan.png',
    });
    fixture.detectChanges();
  }

  it('keeps the viewer open when the backdrop is clicked', () => {
    openViewer();

    const backdrop: HTMLElement | null =
      fixture.nativeElement.querySelector('.image-viewer-overlay');
    expect(backdrop).toBeTruthy();

    backdrop!.click();
    fixture.detectChanges();

    expect(fixture.componentInstance.viewingImage())
      .withContext('backdrop click must not dismiss the viewer')
      .not.toBeNull();
  });

  it('closes on Escape', () => {
    openViewer();

    fixture.componentInstance.onEscapeKey();
    fixture.detectChanges();

    expect(fixture.componentInstance.viewingImage()).toBeNull();
  });

  it('exposes the viewer as a labelled dialog', () => {
    openViewer();

    const dialog: HTMLElement | null =
      fixture.nativeElement.querySelector('.image-viewer-content');
    expect(dialog?.getAttribute('role')).toBe('dialog');
    expect(dialog?.getAttribute('aria-modal')).toBe('true');
    expect(dialog?.getAttribute('aria-labelledby')).toBe('image-viewer-title');
  });
});
